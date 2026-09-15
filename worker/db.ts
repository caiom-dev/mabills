/**
 * Camada fina sobre o D1.
 *
 * Aqui mora o UNICO lugar onde snake_case do banco vira camelCase da API. Se a
 * traducao estivesse espalhada pelas rotas, um dia `color_slot` chegaria cru no
 * frontend e o grafico ficaria cinza sem ninguem entender o porque.
 *
 * Duas regras estruturais desta camada:
 *  - Todo valor entra por bind(). Nada de interpolar string em SQL, nem para
 *    numero: a lista de placeholders e a unica coisa montada dinamicamente, e
 *    ela vem do TAMANHO do array, nunca do conteudo.
 *  - Lote usa db.batch(). Com 10ms de CPU por invocacao, um await por linha no
 *    sync estoura o tempo antes de terminar o mes.
 */

import type {
  Account,
  AccountType,
  Category,
  CategoryKind,
  CategorySource,
  MatchType,
  Rule,
  Transaction,
  TxSource,
  TxStatus,
  TxType,
} from '@shared/types'
import { round2 } from '@shared/money'
import { normalizeText } from './import/normalize'

/** Linha crua do D1. Os mapeadores aceitam o resultado de `.all()` sem cast. */
export type Row = Record<string, unknown>

/**
 * O D1 aceita no maximo 100 parametros por statement; 80 deixa folga para o
 * resto da query.
 */
const MAX_BOUND_PARAMS = 80

/** Tamanho de lote do batch: grande o suficiente para valer a pena, pequeno para nao travar. */
const BATCH_CHUNK = 50

/** Contas sinteticas do fluxo local (lancamento manual e arquivo importado). */
export const MANUAL_ACCOUNT_ID = 'manual'
export const IMPORTED_ACCOUNT_ID = 'imported'

// ---------------------------------------------------------------------------
// Coercao de tipos vindos do SQLite
// ---------------------------------------------------------------------------

function str(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return fallback
  return String(value)
}

function strOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return typeof value === 'string' ? value : String(value)
}

function num(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** SQLite guarda booleano como 0/1. */
function bool(value: unknown): boolean {
  return value === 1 || value === true || value === '1'
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

const CATEGORY_KINDS: readonly CategoryKind[] = ['expense', 'income', 'transfer']
const CATEGORY_SOURCES: readonly CategorySource[] = ['none', 'pluggy', 'rule', 'manual']
const TX_TYPES: readonly TxType[] = ['DEBIT', 'CREDIT']
const TX_STATUSES: readonly TxStatus[] = ['POSTED', 'PENDING']
const TX_SOURCES: readonly TxSource[] = ['pluggy', 'manual', 'ofx', 'csv']
const ACCOUNT_TYPES: readonly AccountType[] = ['BANK', 'CREDIT']
const MATCH_TYPES: readonly MatchType[] = ['contains', 'startsWith', 'exact']

// ---------------------------------------------------------------------------
// Mapeadores linha -> tipo de dominio
// ---------------------------------------------------------------------------

export function rowToCategory(row: Row): Category {
  return {
    id: num(row.id),
    name: str(row.name),
    kind: oneOf(row.kind, CATEGORY_KINDS, 'expense'),
    colorSlot: num(row.color_slot),
    icon: strOrNull(row.icon),
    sortOrder: num(row.sort_order, 100),
    isArchived: bool(row.is_archived),
    isSystem: bool(row.is_system),
  }
}

export function rowToAccount(row: Row): Account {
  return {
    id: str(row.id),
    itemId: str(row.item_id),
    name: str(row.name),
    type: oneOf(row.type, ACCOUNT_TYPES, 'BANK'),
    subtype: strOrNull(row.subtype),
    number: strOrNull(row.number),
    balance: numOrNull(row.balance),
    currency: str(row.currency, 'BRL'),
    isActive: bool(row.is_active),
    syncedAt: strOrNull(row.synced_at),
  }
}

/** Espera as colunas de TRANSACTION_SELECT (com os apelidos do LEFT JOIN). */
export function rowToTransaction(row: Row): Transaction {
  return {
    id: str(row.id),
    accountId: str(row.account_id),
    accountName: strOrNull(row.account_name),
    date: str(row.date),
    amount: round2(num(row.amount)),
    description: str(row.description),
    merchantName: strOrNull(row.merchant_name),
    type: oneOf(row.type, TX_TYPES, 'DEBIT'),
    status: oneOf(row.status, TX_STATUSES, 'POSTED'),
    categoryId: numOrNull(row.category_id),
    categoryName: strOrNull(row.category_name),
    categoryColorSlot: numOrNull(row.category_color_slot),
    categorySource: oneOf(row.category_source, CATEGORY_SOURCES, 'none'),
    isManual: bool(row.is_manual),
    isIgnored: bool(row.is_ignored),
    notes: strOrNull(row.notes),
    source: oneOf(row.source, TX_SOURCES, 'pluggy'),
  }
}

/** Espera o LEFT JOIN em categories com apelido category_name. */
export function rowToRule(row: Row): Rule {
  return {
    id: num(row.id),
    pattern: str(row.pattern),
    matchType: oneOf(row.match_type, MATCH_TYPES, 'contains'),
    categoryId: num(row.category_id),
    categoryName: strOrNull(row.category_name),
    priority: num(row.priority, 100),
    minAmount: numOrNull(row.min_amount),
    maxAmount: numOrNull(row.max_amount),
    hitCount: num(row.hit_count),
  }
}

// ---------------------------------------------------------------------------
// Leitura de transacoes
// ---------------------------------------------------------------------------

/**
 * SELECT canonico de transacao. Os LEFT JOIN (e nao INNER) sao intencionais:
 * transacao sem categoria e o estado normal do dia seguinte ao sync, e ela
 * precisa aparecer na lista justamente para ser categorizada.
 *
 * Use como prefixo e acrescente WHERE/ORDER BY/LIMIT com bind():
 *   `${TRANSACTION_SELECT} WHERE t.date >= ? ORDER BY t.date DESC LIMIT ?`
 */
export const TRANSACTION_SELECT = `
  SELECT t.id, t.account_id, t.date, t.amount, t.description, t.merchant_name,
         t.type, t.status, t.category_id, t.category_source, t.is_manual,
         t.is_ignored, t.notes, t.source,
         c.name       AS category_name,
         c.color_slot AS category_color_slot,
         a.name       AS account_name
  FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN accounts   a ON a.id = t.account_id
`

export async function getTransactionById(
  db: D1Database,
  id: string,
): Promise<Transaction | null> {
  const row = await db.prepare(`${TRANSACTION_SELECT} WHERE t.id = ?`).bind(id).first<Row>()
  return row ? rowToTransaction(row) : null
}

// ---------------------------------------------------------------------------
// Escrita de transacoes
// ---------------------------------------------------------------------------

/**
 * Transacao ja NORMALIZADA, pronta para gravar.
 *
 * Quem chama (sync do Pluggy ou import de OFX/CSV) e responsavel por:
 *  - converter a data para BRT (regra do fuso);
 *  - inverter o sinal do cartao de credito (regra do sinal).
 * Esta camada nao adivinha origem: ela grava o que recebe.
 */
export interface TransactionInput {
  id: string
  accountId: string
  /** 'YYYY-MM-DD' JA em horario de Brasilia. */
  date: string
  /** ISO8601 original em UTC, apenas para auditoria. */
  postedAt?: string | null
  /** JA normalizado: negativo = saida, positivo = entrada. */
  amount: number
  /** Valor como veio da origem, para depurar inversao de sinal. */
  amountRaw?: number | null
  description: string
  descriptionRaw?: string | null
  merchantName?: string | null
  type?: TxType
  status?: TxStatus
  pluggyCategory?: string | null
  categoryId?: number | null
  categorySource?: CategorySource
  isManual?: boolean
  isIgnored?: boolean
  notes?: string | null
  /** Se ausente, e derivado de buildDedupeKey. */
  dedupeKey?: string | null
  source?: TxSource
}

export interface UpsertOutcome {
  inserted: number
  updated: number
}

/**
 * O upsert idempotente.
 *
 * Dois pontos que nao podem mudar:
 *  - ON CONFLICT(id): o id do Pluggy e estavel, entao rodar o sync N vezes
 *    sobre a mesma janela atualiza as mesmas linhas em vez de duplicar.
 *  - O CASE em category_id/category_source: quando o usuario categorizou na mao
 *    (category_source = 'manual'), nenhum sync e nenhuma regra pode desfazer.
 *    Essa protecao fica no SQL de proposito - assim vale para qualquer chamador,
 *    inclusive um que esqueca de checar antes.
 */
const UPSERT_TRANSACTION_SQL = `
  INSERT INTO transactions (
    id, account_id, date, posted_at, amount, amount_raw, description,
    description_raw, merchant_name, type, status, pluggy_category, category_id,
    category_source, is_manual, is_ignored, notes, dedupe_key, source, search_text
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    account_id      = excluded.account_id,
    date            = excluded.date,
    posted_at       = excluded.posted_at,
    amount          = excluded.amount,
    amount_raw      = excluded.amount_raw,
    description     = excluded.description,
    description_raw = excluded.description_raw,
    merchant_name   = excluded.merchant_name,
    search_text     = excluded.search_text,
    type            = excluded.type,
    status          = excluded.status,
    pluggy_category = excluded.pluggy_category,
    dedupe_key      = excluded.dedupe_key,
    category_id     = CASE WHEN transactions.category_source = 'manual'
                           THEN transactions.category_id
                           ELSE excluded.category_id END,
    category_source = CASE WHEN transactions.category_source = 'manual'
                           THEN 'manual'
                           ELSE excluded.category_source END,
    is_ignored      = CASE WHEN transactions.category_source = 'manual'
                           THEN transactions.is_ignored
                           ELSE excluded.is_ignored END,
    notes           = COALESCE(transactions.notes, excluded.notes),
    updated_at      = datetime('now')
`

/** Monta o statement sem executar - use para juntar tudo num db.batch(). */
export function upsertTransactionStatement(
  db: D1Database,
  tx: TransactionInput,
): D1PreparedStatement {
  const amount = round2(tx.amount)
  const type: TxType = tx.type ?? (amount < 0 ? 'DEBIT' : 'CREDIT')
  const dedupeKey = tx.dedupeKey ?? buildDedupeKey(tx.date, amount, tx.accountId)

  return db.prepare(UPSERT_TRANSACTION_SQL).bind(
    tx.id,
    tx.accountId,
    tx.date,
    tx.postedAt ?? null,
    amount,
    tx.amountRaw === undefined || tx.amountRaw === null ? null : round2(tx.amountRaw),
    tx.description,
    tx.descriptionRaw ?? null,
    tx.merchantName ?? null,
    type,
    tx.status ?? 'POSTED',
    tx.pluggyCategory ?? null,
    tx.categoryId ?? null,
    tx.categorySource ?? 'none',
    tx.isManual ? 1 : 0,
    tx.isIgnored ? 1 : 0,
    tx.notes ?? null,
    dedupeKey,
    tx.source ?? 'pluggy',
    normalizeText(`${tx.description} ${tx.merchantName ?? ''}`),
  )
}

/**
 * Grava um lote. Consulta antes quais ids ja existem porque o D1 nao distingue
 * insert de update no resultado - e o sync precisa desses dois numeros.
 */
export async function upsertTransactions(
  db: D1Database,
  transactions: TransactionInput[],
): Promise<UpsertOutcome> {
  // Paginacao do Pluggy pode repetir a mesma transacao entre paginas; o ultimo
  // valor vence e o contador nao conta duas vezes.
  const unique = new Map<string, TransactionInput>()
  for (const tx of transactions) unique.set(tx.id, tx)
  const items = [...unique.values()]
  if (items.length === 0) return { inserted: 0, updated: 0 }

  const existing = await selectExistingTransactionIds(
    db,
    items.map((tx) => tx.id),
  )

  let inserted = 0
  let updated = 0
  for (const tx of items) {
    if (existing.has(tx.id)) updated += 1
    else inserted += 1
  }

  await runBatch(
    db,
    items.map((tx) => upsertTransactionStatement(db, tx)),
  )

  return { inserted, updated }
}

/** Conveniencia para uma linha so (lancamento manual). Prefira o lote no sync. */
export function upsertTransaction(db: D1Database, tx: TransactionInput): Promise<UpsertOutcome> {
  return upsertTransactions(db, [tx])
}

/** Ids ja gravados, consultados em blocos por causa do limite de parametros do D1. */
export async function selectExistingTransactionIds(
  db: D1Database,
  ids: string[],
): Promise<Set<string>> {
  const found = new Set<string>()
  const unique = [...new Set(ids)]

  for (let i = 0; i < unique.length; i += MAX_BOUND_PARAMS) {
    const slice = unique.slice(i, i + MAX_BOUND_PARAMS)
    if (slice.length === 0) continue
    // Placeholders vem do tamanho do array, nunca do conteudo.
    const placeholders = slice.map(() => '?').join(',')
    const result = await db
      .prepare(`SELECT id FROM transactions WHERE id IN (${placeholders})`)
      .bind(...slice)
      .all<Row>()
    for (const row of result.results) found.add(str(row.id))
  }

  return found
}

/** Executa em blocos. Cada bloco e uma transacao atomica no D1. */
export async function runBatch(
  db: D1Database,
  statements: D1PreparedStatement[],
  chunkSize = BATCH_CHUNK,
): Promise<void> {
  const size = Math.max(1, chunkSize)
  for (let i = 0; i < statements.length; i += size) {
    const slice = statements.slice(i, i + size)
    if (slice.length > 0) await db.batch(slice)
  }
}

/**
 * Chave de deduplicacao: 'YYYY-MM-DD|<abs em centavos>|<accountId>'.
 *
 * Serve para o caso em que o mesmo gasto reaparece com id novo - transacao
 * PENDING que vira POSTED troca de id no Pluggy, e o mesmo extrato importado
 * por OFX ja pode ter vindo pela API.
 */
export function buildDedupeKey(date: string, amount: number, accountId: string): string {
  const cents = Math.round(Math.abs(round2(amount)) * 100)
  return `${date}|${cents}|${accountId}`
}

// ---------------------------------------------------------------------------
// Contas
// ---------------------------------------------------------------------------

export interface AccountInput {
  id: string
  itemId: string
  name: string
  type: AccountType
  subtype?: string | null
  number?: string | null
  balance?: number | null
  currency?: string
  isActive?: boolean
  syncedAt?: string | null
}

const UPSERT_ACCOUNT_SQL = `
  INSERT INTO accounts (
    id, item_id, name, type, subtype, number, balance, currency, is_active, synced_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    item_id   = excluded.item_id,
    name      = excluded.name,
    type      = excluded.type,
    subtype   = excluded.subtype,
    number    = excluded.number,
    balance   = excluded.balance,
    currency  = excluded.currency,
    is_active = excluded.is_active,
    synced_at = excluded.synced_at
`

/** Upsert de conta. Precisa rodar ANTES das transacoes: ha FK de account_id. */
export async function ensureAccount(db: D1Database, account: AccountInput): Promise<void> {
  await db
    .prepare(UPSERT_ACCOUNT_SQL)
    .bind(
      account.id,
      account.itemId,
      account.name,
      account.type,
      account.subtype ?? null,
      account.number ?? null,
      account.balance === undefined || account.balance === null ? null : round2(account.balance),
      account.currency ?? 'BRL',
      account.isActive === false ? 0 : 1,
      account.syncedAt ?? null,
    )
    .run()
}

/**
 * Conta local criada sob demanda ('manual' e 'imported').
 *
 * DO NOTHING no conflito: se a conta ja existe, quem manda e o que esta la -
 * o usuario pode ter renomeado. Devolve o id para encadear no insert da
 * transacao.
 */
export async function ensureLocalAccount(
  db: D1Database,
  id: string,
  name: string,
  type: AccountType = 'BANK',
): Promise<string> {
  await db
    .prepare(
      `INSERT INTO accounts (id, item_id, name, type, currency, is_active)
       VALUES (?, 'local', ?, ?, 'BRL', 1)
       ON CONFLICT(id) DO NOTHING`,
    )
    .bind(id, name, type)
    .run()
  return id
}

/** Conta usada por lancamentos digitados no app. */
export function ensureManualAccount(db: D1Database): Promise<string> {
  return ensureLocalAccount(db, MANUAL_ACCOUNT_ID, 'Lançamentos manuais', 'BANK')
}

/** Conta usada por arquivos OFX/CSV sem conta escolhida. */
export function ensureImportedAccount(db: D1Database): Promise<string> {
  return ensureLocalAccount(db, IMPORTED_ACCOUNT_ID, 'Extrato importado', 'BANK')
}

export async function listAccounts(db: D1Database): Promise<Account[]> {
  const result = await db
    .prepare('SELECT * FROM accounts ORDER BY is_active DESC, name')
    .all<Row>()
  return result.results.map(rowToAccount)
}

// ---------------------------------------------------------------------------
// Settings (chave/valor)
// ---------------------------------------------------------------------------

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<Row>()
  return row ? strOrNull(row.value) : null
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .bind(key, value)
    .run()
}
