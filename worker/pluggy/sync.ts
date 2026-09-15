/**
 * Sincronizacao Pluggy -> D1.
 *
 * Tres invariantes mandam neste arquivo:
 *
 * - IDEMPOTENCIA: o id do Pluggy e a PK, e todo insert e ON CONFLICT DO UPDATE.
 *   Rodar o sync 50x na mesma janela nao duplica nada.
 * - O QUE O USUARIO DECIDE, FICA: category_source='manual' nunca e sobrescrito,
 *   e is_ignored/notes nao sao tocados em atualizacao.
 * - PARAR E MELHOR QUE MORRER: com 50 subrequests e 10ms de CPU por invocacao,
 *   a execucao para de forma limpa ao esgotar o orcamento, grava o progresso e
 *   deixa o resto para a proxima. Nenhuma excecao escapa de runSync.
 */

import type { AccountType, CategorySource, SyncResult, TxStatus, TxType } from '@shared/types'
import { round2 } from '@shared/money'
import { addDays, addMonths, isValidDate, monthOf, todayBrt, utcToBrtDate } from '@shared/dates'
import { SUBREQUEST_BUDGET, SYNC_WINDOW_DAYS, type Env } from '../types'
import { buildDedupeKey, ensureAccount } from '../db'
import { categorizeTransaction, loadCategorizationContext } from '../categorize'
import {
  SubrequestBudget,
  fetchAccounts,
  fetchItem,
  fetchTransactionsPage,
  getApiKey,
  isConfigured,
  parseItemIds,
} from './client'
import type { PluggyAccount, PluggyItem, PluggyTransaction, PluggyTransactionPage } from './pluggy-types'

/** Statuses que impedem ler dados: exigem acao do usuario em meu.pluggy.ai. */
const BLOCKING_ITEM_STATUS = new Set(['LOGIN_ERROR', 'WAITING_USER_INPUT'])

/**
 * Sobreposicao da janela incremental. Uma transacao PENDING vira POSTED dias
 * depois e ao mudar pode trocar de valor e de data; sem reler esses dias, a
 * versao definitiva nunca chegaria ao banco.
 */
const OVERLAP_DAYS = 5

/** Janela do backfill manual. */
const BACKFILL_MONTHS = 12

/** Pagina grande = menos paginas = menos subrequests. */
const PAGE_SIZE = 200

/**
 * Linhas por db.batch(). Fica bem abaixo do limite de parametros por statement
 * do D1 (o SELECT de conferencia usa 1 parametro por linha do lote).
 */
const BATCH_SIZE = 25

/** Limite do campo error do sync_log; a mensagem serve para diagnostico, nao para auditoria. */
const MAX_LOG_ERROR = 900

const UPSERT_SQL = `
INSERT INTO transactions (
  id, account_id, date, posted_at, amount, amount_raw,
  description, description_raw, merchant_name, type, status,
  pluggy_category, category_id, category_source,
  is_manual, is_ignored, dedupe_key, source, created_at, updated_at
) VALUES (
  ?, ?, ?, ?, ?, ?,
  ?, ?, ?, ?, ?,
  ?, ?, ?,
  0, 0, ?, 'pluggy', datetime('now'), datetime('now')
)
ON CONFLICT(id) DO UPDATE SET
  date            = excluded.date,
  posted_at       = excluded.posted_at,
  amount          = excluded.amount,
  amount_raw      = excluded.amount_raw,
  description     = excluded.description,
  description_raw = excluded.description_raw,
  merchant_name   = excluded.merchant_name,
  type            = excluded.type,
  status          = excluded.status,
  pluggy_category = excluded.pluggy_category,
  dedupe_key      = excluded.dedupe_key,
  category_id     = CASE
                      WHEN transactions.category_source = 'manual' THEN transactions.category_id
                      WHEN excluded.category_id IS NULL             THEN transactions.category_id
                      ELSE excluded.category_id
                    END,
  category_source = CASE
                      WHEN transactions.category_source = 'manual' THEN 'manual'
                      WHEN excluded.category_id IS NULL             THEN transactions.category_source
                      ELSE excluded.category_source
                    END,
  updated_at      = datetime('now')
`
// Sobre o UPDATE acima: is_manual, is_ignored, notes e source ficam de fora de
// proposito - sao do usuario, nao do Pluggy. E quando a categorizacao nova nao
// acha nada (excluded.category_id IS NULL), preservamos a que ja existia: um
// re-sync nunca pode rebaixar uma categoria ja atribuida.

/** Contexto de categorizacao, sem acoplar ao nome do tipo exportado por ../categorize. */
type CategorizationCtx = Awaited<ReturnType<typeof loadCategorizationContext>>

/** Linha ja normalizada, pronta para o upsert. */
interface TxRow {
  id: string
  accountId: string
  date: string
  postedAt: string
  amount: number
  amountRaw: number
  description: string
  descriptionRaw: string | null
  merchantName: string | null
  type: TxType
  status: TxStatus
  pluggyCategory: string | null
  categoryId: number | null
  categorySource: CategorySource
  dedupeKey: string
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

export async function runSync(
  env: Env,
  trigger: 'cron' | 'manual',
  opts?: { fullBackfill?: boolean },
): Promise<SyncResult> {
  const startedAt = new Date().toISOString()
  const errors: string[] = []
  let inserted = 0
  let updated = 0
  let accountsSynced = 0
  let hadFailure = false

  // Sem credenciais o app continua util (import OFX/CSV, lancamento manual):
  // isto e um aviso, nao uma falha, e nao merece nem linha no sync_log.
  if (!isConfigured(env)) {
    const finishedAt = new Date().toISOString()
    return {
      status: 'ok',
      inserted: 0,
      updated: 0,
      accountsSynced: 0,
      startedAt,
      finishedAt,
      errors: [
        'Pluggy não configurado: defina PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET e PLUGGY_ITEM_IDS para sincronizar automaticamente.',
      ],
    }
  }

  const db = env.DB

  // Abre o log JA com status 'error': se a execucao morrer no meio (CPU,
  // timeout, deploy), fica o rastro em vez de a tentativa sumir sem registro.
  const logId = await openSyncLog(db, startedAt, trigger)

  try {
    const budget = new SubrequestBudget(SUBREQUEST_BUDGET)

    // Reserva o subrequest do /auth mesmo quando o token vem do KV: e mais
    // barato desperdicar 1 de orcamento do que estourar o limite da plataforma.
    budget.take()
    await getApiKey(env)

    // Contexto e ultimas datas carregados UMA vez: dentro do laco custariam
    // uma consulta por conta e CPU que nao temos.
    const ctx = await loadCategorizationContext(db)
    const lastDates = await loadLastSyncedDates(db)

    const today = todayBrt()
    const fullBackfill = opts?.fullBackfill === true
    const pending: TxRow[] = []
    const seenIds = new Set<string>()
    let skipped = 0
    let firstSkipReason: string | null = null

    for (const itemId of parseItemIds(env)) {
      if (!budget.take()) {
        hadFailure = true
        errors.push(`Limite de requisições atingido antes da conexão ${itemId}; a próxima sincronização continua daqui.`)
        break
      }

      let item: PluggyItem
      try {
        item = await fetchItem(env, itemId)
      } catch (err) {
        hadFailure = true
        errors.push(`Conexão ${itemId}: falha ao consultar (${describe(err)}).`)
        continue
      }

      if (BLOCKING_ITEM_STATUS.has(item.status)) {
        hadFailure = true
        const detail = item.error?.message ? ` - ${item.error.message}` : ''
        errors.push(`Conexão ${itemId} está em ${item.status}${detail}: reconecte o banco em meu.pluggy.ai.`)
        continue
      }
      if (item.status === 'OUTDATED') {
        // Nao bloqueia: os dados existem, so podem estar atrasados do lado do
        // Pluggy. Vale avisar, mas nao vale marcar a execucao como parcial.
        errors.push(`Conexão ${itemId} está desatualizada (OUTDATED): pode faltar movimentação recente.`)
      }

      if (!budget.take()) {
        hadFailure = true
        errors.push(`Limite de requisições atingido ao listar contas de ${itemId}; a próxima sincronização continua daqui.`)
        break
      }

      let accounts: PluggyAccount[]
      try {
        accounts = await fetchAccounts(env, itemId)
      } catch (err) {
        hadFailure = true
        errors.push(`Conexão ${itemId}: falha ao listar contas (${describe(err)}).`)
        continue
      }

      for (const account of accounts) {
        // Qualquer coisa que nao seja CREDIT tratamos como BANK: errar para
        // BANK preserva o sinal original, errar para CREDIT o inverteria.
        const accountType: AccountType = account.type === 'CREDIT' ? 'CREDIT' : 'BANK'
        const accountLabel = account.name || account.id

        try {
          await ensureAccount(db, {
            id: account.id,
            itemId,
            name: account.name,
            type: accountType,
            subtype: account.subtype ?? null,
            number: account.number ?? null,
            balance: typeof account.balance === 'number' ? round2(account.balance) : null,
            currency: account.currencyCode ?? 'BRL',
          })
        } catch (err) {
          hadFailure = true
          errors.push(`Conta "${accountLabel}": falha ao registrar (${describe(err)}).`)
          continue
        }

        const dateFrom = windowStart(lastDates.get(account.id), today, fullBackfill)
        let after: string | null = null
        let complete = true

        do {
          if (!budget.take()) {
            hadFailure = true
            complete = false
            errors.push(`Limite de requisições atingido em "${accountLabel}"; a próxima sincronização retoma a partir de ${dateFrom}.`)
            break
          }

          let page: PluggyTransactionPage
          try {
            page = await fetchTransactionsPage(env, {
              accountId: account.id,
              dateFrom,
              dateTo: today,
              after,
              pageSize: PAGE_SIZE,
            })
          } catch (err) {
            hadFailure = true
            complete = false
            errors.push(`Conta "${accountLabel}": falha ao ler transações (${describe(err)}).`)
            break
          }

          for (const tx of page.results) {
            if (!tx || typeof tx.id !== 'string' || !tx.id || seenIds.has(tx.id)) continue
            try {
              pending.push(normalizeTransaction(tx, account.id, accountType, ctx))
              seenIds.add(tx.id)
            } catch (err) {
              // Uma linha torta (data ilegivel, valor nao numerico) nao pode
              // derrubar a sincronizacao inteira; contamos e seguimos.
              skipped += 1
              firstSkipReason ??= describe(err)
            }
          }

          while (pending.length >= BATCH_SIZE) {
            const written = await writeBatch(db, pending.splice(0, BATCH_SIZE))
            inserted += written.inserted
            updated += written.updated
          }

          // Cursor repetido seria laco infinito ate o orcamento acabar.
          const next = page.next
          after = next && next !== after ? next : null
        } while (after)

        if (complete) accountsSynced += 1
        if (budget.exhausted) break
      }

      if (budget.exhausted) break
    }

    if (pending.length > 0) {
      const written = await writeBatch(db, pending)
      inserted += written.inserted
      updated += written.updated
    }

    if (skipped > 0) {
      errors.push(`${skipped} transação(ões) ignorada(s) por dados inválidos${firstSkipReason ? ` (ex.: ${firstSkipReason})` : ''}.`)
    }
  } catch (err) {
    // Rede, D1, JSON malformado: nada escapa daqui para o cron nem para a rota.
    hadFailure = true
    errors.push(`Sincronização interrompida: ${describe(err)}.`)
  }

  // Houve falha e nada entrou -> 'error'. Houve falha mas parte do trabalho
  // saiu -> 'partial', e a proxima execucao retoma o resto.
  const status: SyncResult['status'] = !hadFailure
    ? 'ok'
    : accountsSynced > 0 || inserted + updated > 0
      ? 'partial'
      : 'error'

  const result: SyncResult = {
    status,
    inserted,
    updated,
    accountsSynced,
    startedAt,
    finishedAt: new Date().toISOString(),
    errors,
  }

  await closeSyncLog(db, logId, result)
  return result
}

// ---------------------------------------------------------------------------
// Normalizacao
// ---------------------------------------------------------------------------

function normalizeTransaction(
  tx: PluggyTransaction,
  accountId: string,
  accountType: AccountType,
  ctx: CategorizationCtx,
): TxRow {
  const amountRaw = typeof tx.amount === 'number' ? tx.amount : Number(tx.amount)
  if (!Number.isFinite(amountRaw)) throw new Error(`valor inválido em ${tx.id}`)

  // Regra de sinal do sistema: negativo = saida, positivo = entrada. Em conta
  // BANK o Pluggy ja manda assim; em CREDIT a convencao e invertida (positivo =
  // despesa). A inversao acontece AQUI, na ingestao - nunca na leitura.
  const amount = round2(accountType === 'CREDIT' ? -amountRaw : amountRaw)

  // O Pluggy manda ISO8601 em UTC. Uma compra as 21h de 31/08 em Brasilia chega
  // como 2026-09-01T00:00:00Z e, sem converter, cairia no orcamento errado.
  const date = utcToBrtDate(tx.date)

  const merchantName = cleanText(tx.merchant?.name) ?? cleanText(tx.merchant?.businessName)
  const descriptionRaw = cleanText(tx.descriptionRaw)
  const description =
    cleanText(tx.description) ?? descriptionRaw ?? merchantName ?? 'Sem descrição'
  const pluggyCategory = cleanText(tx.category)

  const categorized = categorizeTransaction(ctx, {
    description,
    merchantName,
    amount,
    pluggyCategory,
  })

  return {
    id: tx.id,
    accountId,
    date,
    postedAt: tx.date,
    amount,
    amountRaw: round2(amountRaw),
    description,
    descriptionRaw,
    merchantName,
    // Derivado do valor JA normalizado para o campo nunca contradizer o sinal -
    // em cartao, o `type` que vem do Pluggy segue a convencao invertida.
    type: (amount < 0 ? 'DEBIT' : 'CREDIT') satisfies TxType,
    status: (tx.status === 'PENDING' ? 'PENDING' : 'POSTED') satisfies TxStatus,
    pluggyCategory,
    categoryId: categorized.categoryId,
    categorySource: categorized.source,
    dedupeKey: buildDedupeKey(date, amount, accountId),
  }
}

function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/**
 * Inicio da janela de busca.
 *
 * Incremental por padrao: da ultima data conhecida menos a sobreposicao. Conta
 * nova nao tem data conhecida e leva a janela padrao inteira.
 */
function windowStart(lastDate: string | undefined, today: string, fullBackfill: boolean): string {
  if (fullBackfill) return `${addMonths(monthOf(today), -BACKFILL_MONTHS)}-01`
  if (lastDate && isValidDate(lastDate)) return addDays(lastDate, -OVERLAP_DAYS)
  return addDays(today, -SYNC_WINDOW_DAYS)
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

/**
 * Grava um lote e devolve quantos eram novos.
 *
 * O SELECT vai como PRIMEIRO statement do mesmo batch: db.batch() executa em
 * ordem e numa transacao, entao ele enxerga o estado anterior aos upserts e
 * separa inserido de atualizado sem ida extra ao D1. A alternativa (contar por
 * meta.changes) nao funciona: em ON CONFLICT DO UPDATE o changes vale 1 nos
 * dois casos.
 */
async function writeBatch(
  db: D1Database,
  rows: TxRow[],
): Promise<{ inserted: number; updated: number }> {
  if (rows.length === 0) return { inserted: 0, updated: 0 }

  const placeholders = rows.map(() => '?').join(',')
  const existing = db
    .prepare(`SELECT id FROM transactions WHERE id IN (${placeholders})`)
    .bind(...rows.map((row) => row.id))

  const upsert = db.prepare(UPSERT_SQL)
  const statements = [
    existing,
    ...rows.map((row) =>
      upsert.bind(
        row.id,
        row.accountId,
        row.date,
        row.postedAt,
        row.amount,
        row.amountRaw,
        row.description,
        row.descriptionRaw,
        row.merchantName,
        row.type,
        row.status,
        row.pluggyCategory,
        row.categoryId,
        row.categorySource,
        row.dedupeKey,
      ),
    ),
  ]

  const results = await db.batch<{ id: string }>(statements)
  const alreadyThere = (results[0]?.results ?? []).length
  return { inserted: rows.length - alreadyThere, updated: alreadyThere }
}

/**
 * Ultima data ja sincronizada por conta, em UMA consulta agregada.
 *
 * Filtra source='pluggy' de proposito: uma importacao OFX antiga poderia empurrar
 * o MAX para tras (ou para frente) e deslocar a janela do sync.
 */
async function loadLastSyncedDates(db: D1Database): Promise<Map<string, string>> {
  const res = await db
    .prepare(
      `SELECT account_id AS accountId, MAX(date) AS lastDate
         FROM transactions
        WHERE source = 'pluggy'
        GROUP BY account_id`,
    )
    .all<{ accountId: string; lastDate: string | null }>()

  const map = new Map<string, string>()
  for (const row of res.results ?? []) {
    if (row.lastDate) map.set(row.accountId, row.lastDate)
  }
  return map
}

async function openSyncLog(
  db: D1Database,
  startedAt: string,
  trigger: string,
): Promise<number | null> {
  try {
    const res = await db
      .prepare(`INSERT INTO sync_log (started_at, trigger, status) VALUES (?, ?, 'error')`)
      .bind(startedAt, trigger)
      .run()
    const id = res.meta?.last_row_id
    return typeof id === 'number' ? id : null
  } catch {
    // Nao conseguir logar nao e motivo para nao sincronizar.
    return null
  }
}

async function closeSyncLog(
  db: D1Database,
  logId: number | null,
  result: SyncResult,
): Promise<void> {
  if (logId === null) return
  const error = result.errors.length > 0 ? truncate(result.errors.join(' | '), MAX_LOG_ERROR) : null
  try {
    await db
      .prepare(
        `UPDATE sync_log
            SET finished_at = ?, status = ?, inserted = ?, updated = ?, accounts_synced = ?, error = ?
          WHERE id = ?`,
      )
      .bind(
        result.finishedAt,
        result.status,
        result.inserted,
        result.updated,
        result.accountsSynced,
        error,
        logId,
      )
      .run()
  } catch {
    // O resultado ja esta no retorno; falhar aqui nao pode virar excecao.
  }
}

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

function describe(err: unknown): string {
  if (err instanceof Error) return truncate(err.message, 200)
  return truncate(String(err), 200)
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text
}
