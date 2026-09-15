/**
 * Rotas de transacoes.
 *
 * Tres coisas merecem atencao aqui:
 *
 * 1. O WHERE da listagem e montado a partir de um array de condicoes e um array
 *    de binds paralelos. Nenhum valor vindo do cliente entra na string SQL.
 * 2. Trocar a categoria pela interface grava category_source='manual'. Dali em
 *    diante nem o sync nem as regras encostam nessa transacao - e o que torna a
 *    correcao do usuario definitiva.
 * 3. O atalho createRule transforma uma correcao pontual em regra permanente e
 *    reaplica no passado. E ele que faz a categorizacao ficar boa em duas
 *    semanas em vez de nunca.
 */

import { Hono } from 'hono'
import type {
  CategorySource,
  CreateTransactionRequest,
  Rule,
  Transaction,
  TransactionListResponse,
  UpdateTransactionRequest,
  UpdateTransactionResponse,
} from '@shared/types'
import { isValidDate, isValidMonth, monthBounds } from '@shared/dates'
import { round2 } from '@shared/money'
import { apiError, badRequest, json, type AppEnv } from '../http'
import { ensureLocalAccount, rowToTransaction } from '../db'
import {
  applyRuleBackfill,
  categorizeTransaction,
  createRuleFromTransaction,
  loadCategorizationContext,
} from '../categorize'
import { normalizeText, suggestRulePattern } from '../import/normalize'

/**
 * A linha crua do D1 (snake_case) so existe para ser traduzida por rowToTransaction.
 * Dar um tipo proprio a ela aqui duplicaria o contrato que ja vive em ../db.
 */
type DbRow = any

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500
const MAX_DESCRIPTION = 200
const MAX_NOTES = 500
const MIN_PATTERN_LENGTH = 3

/** Colunas da transacao ja com os nomes de categoria e conta resolvidos. */
const TX_SELECT = `
  SELECT t.*,
         c.name       AS category_name,
         c.color_slot AS category_color_slot,
         a.name       AS account_name
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN accounts   a ON a.id = t.account_id
`

export const transactionRoutes = new Hono<AppEnv>()

// ---------------------------------------------------------------------------
// GET /transactions
// ---------------------------------------------------------------------------

transactionRoutes.get('/transactions', async (c) => {
  const db = c.env.DB
  const conditions: string[] = []
  const binds: unknown[] = []

  const month = c.req.query('month')
  if (month) {
    if (!isValidMonth(month)) return badRequest("Mês inválido. Use o formato 'AAAA-MM'.")
    // Comparar a coluna date por intervalo aproveita idx_tx_date; substr() nao.
    const { from, to } = monthBounds(month)
    conditions.push('t.date >= ? AND t.date <= ?')
    binds.push(from, to)
  }

  const categoryIdRaw = c.req.query('categoryId')
  if (categoryIdRaw) {
    const categoryId = Number(categoryIdRaw)
    if (!Number.isInteger(categoryId) || categoryId <= 0) return badRequest('Categoria inválida.')
    conditions.push('t.category_id = ?')
    binds.push(categoryId)
  }

  const accountId = c.req.query('accountId')
  if (accountId) {
    conditions.push('t.account_id = ?')
    binds.push(accountId)
  }

  const q = c.req.query('q')?.trim()
  if (q) {
    conditions.push(
      "(LOWER(t.description) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(t.merchant_name, '')) LIKE ? ESCAPE '\\')",
    )
    const like = likePattern(q)
    binds.push(like, like)
  }

  if (isTrue(c.req.query('uncategorized'))) {
    conditions.push('t.category_id IS NULL')
  }

  const limit = clampInt(c.req.query('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT)
  const offset = clampInt(c.req.query('offset'), 0, 0, 1_000_000)
  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const totalRow = await prepare(
    db,
    `SELECT COUNT(*) AS total FROM transactions t ${whereSql}`,
    binds,
  ).first<{ total: number }>()
  const total = totalRow?.total ?? 0

  const listed = await prepare(
    db,
    `${TX_SELECT} ${whereSql} ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?`,
    [...binds, limit, offset],
  ).all<DbRow>()

  const items: Transaction[] = (listed.results ?? []).map(rowToTransaction)
  const body: TransactionListResponse = {
    items,
    total,
    hasMore: offset + items.length < total,
  }
  return json(body)
})

// ---------------------------------------------------------------------------
// POST /transactions - lancamento manual (dinheiro, Pix que nao cai no extrato)
// ---------------------------------------------------------------------------

transactionRoutes.post('/transactions', async (c) => {
  const db = c.env.DB

  const parsed = await readJson<CreateTransactionRequest>(c.req.raw)
  if (!parsed.ok) return badRequest(parsed.error)
  const body = parsed.value

  const date = typeof body.date === 'string' ? body.date.trim() : ''
  if (!isValidDate(date)) return badRequest("Data inválida. Use o formato 'AAAA-MM-DD'.")

  const rawAmount = body.amount
  if (typeof rawAmount !== 'number' || !Number.isFinite(rawAmount) || rawAmount <= 0) {
    return badRequest('Valor inválido. Informe um número maior que zero.')
  }

  const description = typeof body.description === 'string' ? body.description.trim() : ''
  if (!description) return badRequest('Descrição obrigatória.')
  if (description.length > MAX_DESCRIPTION) {
    return badRequest(`Descrição muito longa (máximo ${MAX_DESCRIPTION} caracteres).`)
  }

  if (body.kind !== 'expense' && body.kind !== 'income') {
    return badRequest("Tipo inválido. Use 'expense' para saída ou 'income' para entrada.")
  }

  let categoryId: number | null = null
  if (body.categoryId !== null && body.categoryId !== undefined) {
    if (!Number.isInteger(body.categoryId) || body.categoryId <= 0) {
      return badRequest('Categoria inválida.')
    }
    const found = await db
      .prepare('SELECT id FROM categories WHERE id = ?')
      .bind(body.categoryId)
      .first<{ id: number }>()
    if (!found) return apiError('Categoria não encontrada.', 404)
    categoryId = body.categoryId
  }

  let accountId: string
  if (typeof body.accountId === 'string' && body.accountId.trim() !== '') {
    accountId = body.accountId.trim()
    const account = await db
      .prepare('SELECT id FROM accounts WHERE id = ?')
      .bind(accountId)
      .first<{ id: string }>()
    if (!account) return apiError('Conta não encontrada.', 404)
  } else {
    accountId = await ensureLocalAccount(db, 'manual', 'Lançamento manual', 'BANK')
  }

  const notes = typeof body.notes === 'string' && body.notes.trim() !== ''
    ? body.notes.trim().slice(0, MAX_NOTES)
    : null

  // O sinal e responsabilidade desta camada: o cliente manda sempre o valor
  // absoluto e diz apenas se e entrada ou saida.
  const amount = round2(body.kind === 'expense' ? -rawAmount : rawAmount)

  let categorySource: CategorySource = 'none'
  if (categoryId !== null) {
    categorySource = 'manual'
  } else {
    const ctx = await loadCategorizationContext(db)
    const suggestion = categorizeTransaction(ctx, { description, amount })
    if (suggestion?.categoryId != null) {
      categoryId = suggestion.categoryId
      categorySource = 'rule'
    }
  }

  const id = `man_${crypto.randomUUID()}`
  await db
    .prepare(
      `INSERT INTO transactions
         (id, account_id, date, amount, amount_raw, description, description_raw,
          type, status, category_id, category_source, is_manual, is_ignored, notes, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', ?, ?, 1, 0, ?, 'manual')`,
    )
    .bind(
      id,
      accountId,
      date,
      amount,
      amount,
      description,
      description,
      amount < 0 ? 'DEBIT' : 'CREDIT',
      categoryId,
      categorySource,
      notes,
    )
    .run()

  const created = await fetchTransaction(db, id)
  if (!created) return apiError('Não consegui reler o lançamento recém-criado.', 500)
  return json(created)
})

// ---------------------------------------------------------------------------
// PATCH /transactions/:id
// ---------------------------------------------------------------------------

transactionRoutes.patch('/transactions/:id', async (c) => {
  const db = c.env.DB
  const id = c.req.param('id')
  if (!id) return badRequest('Identificador da transação ausente.')

  const existing = await db
    .prepare('SELECT id, description, category_id FROM transactions WHERE id = ?')
    .bind(id)
    .first<{ id: string; description: string; category_id: number | null }>()
  if (!existing) return apiError('Transação não encontrada.', 404)

  const parsed = await readJson<UpdateTransactionRequest>(c.req.raw)
  if (!parsed.ok) return badRequest(parsed.error)
  const body = parsed.value

  const sets: string[] = []
  const binds: unknown[] = []
  let nextCategoryId: number | null = existing.category_id

  if (body.categoryId !== undefined) {
    if (body.categoryId === null) {
      // Limpar a categoria e um "nao sei ainda", nao uma decisao final: volta
      // para 'none' justamente para a categorizacao automatica poder agir de novo.
      sets.push('category_id = NULL', "category_source = 'none'")
      nextCategoryId = null
    } else {
      if (!Number.isInteger(body.categoryId) || body.categoryId <= 0) {
        return badRequest('Categoria inválida.')
      }
      const found = await db
        .prepare('SELECT id FROM categories WHERE id = ?')
        .bind(body.categoryId)
        .first<{ id: number }>()
      if (!found) return apiError('Categoria não encontrada.', 404)
      // A escolha do usuario passa a ser inviolavel pelo sync e pelas regras.
      sets.push('category_id = ?', "category_source = 'manual'")
      binds.push(body.categoryId)
      nextCategoryId = body.categoryId
    }
  }

  if (body.isIgnored !== undefined) {
    if (typeof body.isIgnored !== 'boolean') return badRequest('O campo isIgnored deve ser booleano.')
    sets.push('is_ignored = ?')
    binds.push(body.isIgnored ? 1 : 0)
  }

  if (body.notes !== undefined) {
    if (body.notes !== null && typeof body.notes !== 'string') return badRequest('Nota inválida.')
    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, MAX_NOTES) : ''
    sets.push('notes = ?')
    binds.push(notes === '' ? null : notes)
  }

  const wantsRule = body.createRule === true
  if (!wantsRule && sets.length === 0) return badRequest('Nada para atualizar.')

  // A regra e validada ANTES do UPDATE para nao existir um estado em que a
  // transacao foi alterada e a requisicao respondeu erro.
  let rulePattern = ''
  if (wantsRule) {
    if (nextCategoryId === null) {
      return badRequest('Escolha uma categoria antes de criar a regra.')
    }
    if (body.rulePattern !== undefined && typeof body.rulePattern !== 'string') {
      return badRequest('Padrão da regra inválido.')
    }
    const source = body.rulePattern && body.rulePattern.trim() !== ''
      ? body.rulePattern
      : suggestRulePattern(existing.description)
    rulePattern = normalizeText(source).trim()
    if (rulePattern.length < MIN_PATTERN_LENGTH) {
      return badRequest(
        `Padrão da regra muito curto (mínimo ${MIN_PATTERN_LENGTH} caracteres). Informe um texto em rulePattern.`,
      )
    }
  }

  if (sets.length > 0) {
    sets.push("updated_at = datetime('now')")
    await db
      .prepare(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...binds, id)
      .run()
  }

  let ruleCreated: Rule | null = null
  let backfilled = 0
  if (wantsRule && nextCategoryId !== null) {
    ruleCreated = await createRuleFromTransaction(db, {
      pattern: rulePattern,
      categoryId: nextCategoryId,
    })
    // O backfill roda depois do UPDATE: esta transacao ja esta marcada como
    // 'manual' e por isso fica imune ao proprio backfill que acabou de gerar.
    backfilled = await applyRuleBackfill(db, ruleCreated)
  }

  const transaction = await fetchTransaction(db, id)
  if (!transaction) return apiError('Transação não encontrada.', 404)

  const response: UpdateTransactionResponse = { transaction, ruleCreated, backfilled }
  return json(response)
})

// ---------------------------------------------------------------------------
// DELETE /transactions/:id
// ---------------------------------------------------------------------------

transactionRoutes.delete('/transactions/:id', async (c) => {
  const db = c.env.DB
  const id = c.req.param('id')
  if (!id) return badRequest('Identificador da transação ausente.')

  const row = await db
    .prepare('SELECT is_manual FROM transactions WHERE id = ?')
    .bind(id)
    .first<{ is_manual: number }>()
  if (!row) return apiError('Transação não encontrada.', 404)

  if (row.is_manual !== 1) {
    return apiError(
      'Só é possível apagar lançamentos manuais. Uma transação vinda do banco voltaria no próximo sync — use "ignorar" para tirá-la do orçamento.',
      400,
      { code: 'not_manual' },
    )
  }

  await db.prepare('DELETE FROM transactions WHERE id = ? AND is_manual = 1').bind(id).run()
  return json({ ok: true })
})

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

async function fetchTransaction(db: D1Database, id: string): Promise<Transaction | null> {
  const row = await db.prepare(`${TX_SELECT} WHERE t.id = ?`).bind(id).first<DbRow>()
  return row ? rowToTransaction(row) : null
}

/** D1 rejeita bind() sem argumentos em alguns runtimes; por isso o desvio. */
function prepare(db: D1Database, sql: string, binds: unknown[]): D1PreparedStatement {
  const stmt = db.prepare(sql)
  return binds.length > 0 ? stmt.bind(...binds) : stmt
}

/** Escapa os curingas do LIKE para uma busca por '%' nao virar "tudo". */
function likePattern(term: string): string {
  const escaped = term.toLowerCase().replace(/[\\%_]/g, (ch) => `\\${ch}`)
  return `%${escaped}%`
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

function isTrue(raw: string | undefined): boolean {
  return raw === '1' || raw === 'true'
}

type JsonResult<T> = { ok: true; value: Partial<T> } | { ok: false; error: string }

async function readJson<T>(request: Request): Promise<JsonResult<T>> {
  try {
    const parsed: unknown = await request.json()
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'Corpo inválido: esperado um objeto JSON.' }
    }
    return { ok: true, value: parsed as Partial<T> }
  } catch {
    return { ok: false, error: 'Corpo inválido: esperado JSON.' }
  }
}
