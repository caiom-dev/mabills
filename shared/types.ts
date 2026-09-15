/**
 * Contratos compartilhados entre o Worker (backend) e o app React (frontend).
 *
 * Convencao: o banco usa snake_case, a API e o TypeScript usam camelCase.
 * A traducao acontece na camada de rotas do Worker, em um unico lugar.
 *
 * Regra de sinal (vale para todo o sistema): `amount` NEGATIVO e saida de
 * dinheiro, POSITIVO e entrada. Isso ja vem normalizado do momento da ingestao,
 * inclusive para cartao de credito, onde o Pluggy usa a convencao oposta.
 */

// ---------------------------------------------------------------------------
// Enums de dominio
// ---------------------------------------------------------------------------

export type CategoryKind = 'expense' | 'income' | 'transfer'
export type CategorySource = 'none' | 'pluggy' | 'rule' | 'manual'
export type TxStatus = 'POSTED' | 'PENDING'
export type TxType = 'DEBIT' | 'CREDIT'
export type TxSource = 'pluggy' | 'manual' | 'ofx' | 'csv'
export type AccountType = 'BANK' | 'CREDIT'
export type MatchType = 'contains' | 'startsWith' | 'exact'

/** Estado de um orcamento no mes corrente. */
export type BudgetState = 'ok' | 'atencao' | 'estourado' | 'sem_orcamento'

/** Ritmo de gasto comparado ao quanto do mes ja passou. */
export type PaceStatus = 'tranquilo' | 'no_ritmo' | 'acelerado' | 'sem_orcamento'

// ---------------------------------------------------------------------------
// Entidades
// ---------------------------------------------------------------------------

export interface Category {
  id: number
  name: string
  kind: CategoryKind
  /** 0 = neutro/cinza, 1..8 = slot da paleta categorica validada. */
  colorSlot: number
  icon: string | null
  sortOrder: number
  isArchived: boolean
  isSystem: boolean
}

export interface Account {
  id: string
  itemId: string
  name: string
  type: AccountType
  subtype: string | null
  number: string | null
  balance: number | null
  currency: string
  isActive: boolean
  syncedAt: string | null
}

export interface Transaction {
  id: string
  accountId: string
  accountName: string | null
  /** 'YYYY-MM-DD' no horario de Brasilia. */
  date: string
  amount: number
  description: string
  merchantName: string | null
  type: TxType
  status: TxStatus
  categoryId: number | null
  categoryName: string | null
  categoryColorSlot: number | null
  categorySource: CategorySource
  isManual: boolean
  isIgnored: boolean
  notes: string | null
  source: TxSource
}

export interface Rule {
  id: number
  pattern: string
  matchType: MatchType
  categoryId: number
  categoryName: string | null
  priority: number
  minAmount: number | null
  maxAmount: number | null
  hitCount: number
}

export interface Budget {
  categoryId: number
  /** 'YYYY-MM' ou '*' para o teto recorrente padrao. */
  month: string
  limitAmount: number
}

// ---------------------------------------------------------------------------
// Visoes calculadas
// ---------------------------------------------------------------------------

export interface BudgetProgress {
  categoryId: number
  categoryName: string
  colorSlot: number
  icon: string | null
  /** null quando a categoria nao tem teto definido. */
  limitAmount: number | null
  spent: number
  /** limite - gasto. Negativo significa estouro. */
  remaining: number | null
  /** 0..N, onde 1 = exatamente no limite. null se nao ha teto. */
  percent: number | null
  state: BudgetState
  txCount: number
}

/**
 * O indicador que avisa ANTES do estouro: compara o percentual ja gasto com o
 * percentual do mes que ja passou.
 */
export interface Pace {
  status: PaceStatus
  /** 0..1 - quanto do mes ja passou. */
  monthElapsed: number
  /** 0..N - quanto do orcamento total ja foi consumido. */
  budgetUsed: number
  /** Projecao de gasto no fim do mes, mantido o ritmo atual. */
  projectedSpend: number
  /** projecao - teto total. Positivo = vai estourar. */
  projectedOverspend: number
  /** Quanto da para gastar por dia no restante do mes sem estourar. */
  safeDailySpend: number
  daysLeft: number
}

export interface MonthSummary {
  /** 'YYYY-MM' */
  month: string
  totalSpent: number
  totalIncome: number
  /** Soma dos tetos definidos. */
  totalBudget: number
  /** teto total - gasto. */
  remaining: number
  /** renda - gasto, independente de orcamento. */
  netFlow: number
  pace: Pace
  budgets: BudgetProgress[]
  /** Categorias em atencao ou estouradas, piores primeiro. */
  attention: BudgetProgress[]
  recentTransactions: Transaction[]
  uncategorizedCount: number
  lastSyncAt: string | null
  lastSyncStatus: string | null
}

export interface CategoryBreakdown {
  categoryId: number | null
  categoryName: string
  colorSlot: number
  spent: number
  share: number
  txCount: number
}

export interface MonthTrend {
  month: string
  totalSpent: number
  byCategory: { categoryId: number; spent: number }[]
}

// ---------------------------------------------------------------------------
// Sincronizacao
// ---------------------------------------------------------------------------

export interface SyncResult {
  status: 'ok' | 'partial' | 'error'
  inserted: number
  updated: number
  accountsSynced: number
  startedAt: string
  finishedAt: string
  errors: string[]
}

export interface SyncStatus {
  lastSyncAt: string | null
  lastStatus: 'ok' | 'partial' | 'error' | null
  lastError: string | null
  /** Contas com problema de conexao (ex.: LOGIN_ERROR, exige reconectar). */
  itemIssues: { itemId: string; status: string; message: string }[]
  configured: boolean
  accounts: Account[]
}

// ---------------------------------------------------------------------------
// Importacao (OFX / CSV)
// ---------------------------------------------------------------------------

export interface ParsedTransaction {
  externalId: string | null
  date: string
  amount: number
  description: string
}

export interface ImportPreviewRow extends ParsedTransaction {
  /** Categoria sugerida pelo motor de regras. */
  suggestedCategoryId: number | null
  suggestedCategoryName: string | null
  duplicate: boolean
  duplicateReason: 'id' | 'dedupe_key' | null
}

export interface ImportPreview {
  token: string
  accountId: string
  accountName: string
  rows: ImportPreviewRow[]
  newCount: number
  duplicateCount: number
  dateRange: { from: string; to: string } | null
}

export interface ImportResult {
  inserted: number
  skipped: number
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export interface LoginRequest {
  pin: string
}

export interface UpdateTransactionRequest {
  categoryId?: number | null
  isIgnored?: boolean
  notes?: string | null
  /**
   * Quando true, cria uma regra a partir do texto desta transacao e reaplica
   * nas demais nao-manuais. E o que faz a categorizacao ficar boa em duas
   * semanas em vez de nunca.
   */
  createRule?: boolean
  /** Texto da regra. Se ausente, e derivado da descricao. */
  rulePattern?: string
}

export interface UpdateTransactionResponse {
  transaction: Transaction
  ruleCreated: Rule | null
  backfilled: number
}

export interface CreateTransactionRequest {
  date: string
  /** Valor absoluto; o sinal vem de `kind`. */
  amount: number
  description: string
  categoryId: number | null
  kind: 'expense' | 'income'
  accountId?: string
  notes?: string | null
}

export interface UpsertBudgetRequest {
  categoryId: number
  month: string
  limitAmount: number
}

export interface BudgetSuggestion {
  categoryId: number
  categoryName: string
  /** Media dos ultimos meses com movimento. */
  suggested: number
  monthsConsidered: number
}

export interface CreateCategoryRequest {
  name: string
  kind: CategoryKind
  colorSlot: number
  icon?: string | null
}

export interface CreateRuleRequest {
  pattern: string
  matchType?: MatchType
  categoryId: number
  priority?: number
}

/**
 * Somas do filtro atual.
 *
 * A listagem sempre devolveu apenas a CONTAGEM de lançamentos. Para auditar uma
 * categoria isso não basta: a pergunta é quanto saiu, e principalmente quanto
 * do que saiu não aparece no total do mês.
 */
export interface TransactionTotals {
  /** Soma das saídas do filtro, incluindo o que não conta no mês. */
  spent: number
  /** Soma das entradas do filtro. */
  income: number
  /**
   * Parte de `spent` que o resumo do mês NÃO soma: lançamento marcado como
   * ignorado, ou de categoria do tipo transferência.
   *
   * É o número que explica a diferença entre "o que saiu da conta" e "o que o
   * app chama de gasto" — sem ele, a divergência parece erro de conta.
   */
  outOfMonthTotal: number
  /** Quantos lançamentos do filtro estão fora do total do mês. */
  outOfMonthCount: number
}

export interface TransactionListResponse {
  items: Transaction[]
  total: number
  hasMore: boolean
  totals: TransactionTotals
}

export interface ApiError {
  error: string
  code?: string
  retryAfterSeconds?: number
}

// ---------------------------------------------------------------------------
// Notificacoes push
// ---------------------------------------------------------------------------

export interface PushStatus {
  /** false quando o servidor nao tem o par de chaves VAPID. */
  configured: boolean
  /** Chave publica VAPID, usada pelo navegador em applicationServerKey. */
  publicKey: string | null
  /** Aparelhos inscritos. */
  devices: number
}

/** O que o navegador devolve em PushSubscription.toJSON(). */
export interface PushSubscriptionInput {
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
}

export interface PushSendResult {
  sent: number
  /** Inscricoes apagadas por terem expirado no servico de push. */
  removed: number
  failed: number
}
