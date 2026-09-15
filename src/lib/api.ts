/**
 * Cliente da API.
 *
 * Regra central: sessao expirada chega aqui como 401 JSON e vira ApiError. O app
 * reage mostrando a tela de PIN dentro do proprio PWA. Nao existe redirect em
 * lugar nenhum - um 302 cross-origin viraria erro opaco de CORS e deixaria o app
 * em tela branca no iPhone.
 */

import type {
  Account,
  BalanceSummary,
  CreatePotRequest,
  Pot,
  BudgetProgress,
  BudgetSuggestion,
  Category,
  CategoryBreakdown,
  CreateCategoryRequest,
  CreateRuleRequest,
  CreateTransactionRequest,
  ImportPreview,
  ImportResult,
  MonthSummary,
  MonthTrend,
  PushSendResult,
  PushStatus,
  PushSubscriptionInput,
  Rule,
  SyncResult,
  SyncStatus,
  Transaction,
  TransactionListResponse,
  UpdateTransactionRequest,
  UpdateTransactionResponse,
  UpsertBudgetRequest,
} from '@shared/types'

export class ApiError extends Error {
  readonly status: number
  readonly code: string | undefined
  readonly retryAfterSeconds: number | undefined

  constructor(message: string, status: number, code?: string, retryAfterSeconds?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.retryAfterSeconds = retryAfterSeconds
  }

  get isUnauthenticated(): boolean {
    return this.status === 401
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    })
  } catch {
    // Falha de rede: mensagem util em vez do "Failed to fetch" do navegador.
    throw new ApiError('Sem conexão com o servidor.', 0, 'offline')
  }

  if (response.status === 204) return undefined as T

  const text = await response.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }

  if (!response.ok) {
    const body = (data ?? {}) as { error?: string; code?: string; retryAfterSeconds?: number }
    throw new ApiError(
      body.error ?? 'Não foi possível completar a operação.',
      response.status,
      body.code,
      body.retryAfterSeconds,
    )
  }

  return data as T
}

const post = <T>(path: string, body?: unknown): Promise<T> =>
  apiFetch<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

const patch = <T>(path: string, body: unknown): Promise<T> =>
  apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) })

const put = <T>(path: string, body: unknown): Promise<T> =>
  apiFetch<T>(path, { method: 'PUT', body: JSON.stringify(body) })

const del = <T>(path: string): Promise<T> => apiFetch<T>(path, { method: 'DELETE' })

export interface TransactionFilters {
  month?: string
  categoryId?: number | null
  accountId?: string | null
  q?: string
  uncategorized?: boolean
  limit?: number
  offset?: number
}

function toQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === false) continue
    search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `?${query}` : ''
}

export const api = {
  login: (pin: string) => post<{ ok: true }>('/auth/login', { pin }),
  logout: () => post<{ ok: true }>('/auth/logout'),
  me: () => apiFetch<{ authenticated: boolean }>('/auth/me'),

  summary: (month: string) => apiFetch<MonthSummary>(`/summary${toQuery({ month })}`),
  breakdown: (month: string) => apiFetch<CategoryBreakdown[]>(`/breakdown${toQuery({ month })}`),
  /** O espelho: o que ficou de fora do total do mês (transferências e ignorados). */
  breakdownOutOfMonth: (month: string) =>
    apiFetch<CategoryBreakdown[]>(`/breakdown${toQuery({ month, scope: 'out' })}`),
  trends: (months: number) => apiFetch<MonthTrend[]>(`/trends${toQuery({ months })}`),

  transactions: (filters: TransactionFilters) =>
    apiFetch<TransactionListResponse>(`/transactions${toQuery({ ...filters })}`),
  createTransaction: (body: CreateTransactionRequest) => post<Transaction>('/transactions', body),
  updateTransaction: (id: string, body: UpdateTransactionRequest) =>
    patch<UpdateTransactionResponse>(`/transactions/${encodeURIComponent(id)}`, body),
  deleteTransaction: (id: string) => del<{ ok: true }>(`/transactions/${encodeURIComponent(id)}`),

  categories: () => apiFetch<Category[]>('/categories'),
  createCategory: (body: CreateCategoryRequest) => post<Category>('/categories', body),
  updateCategory: (id: number, body: Partial<CreateCategoryRequest> & { isArchived?: boolean }) =>
    patch<Category>(`/categories/${id}`, body),
  deleteCategory: (id: number) => del<{ ok: true }>(`/categories/${id}`),

  budgets: (month: string) => apiFetch<BudgetProgress[]>(`/budgets${toQuery({ month })}`),
  upsertBudget: (body: UpsertBudgetRequest) => put<{ ok: true }>('/budgets', body),
  deleteBudget: (categoryId: number, month: string) =>
    del<{ ok: true }>(`/budgets/${categoryId}${toQuery({ month })}`),
  budgetSuggestions: (month: string) =>
    apiFetch<BudgetSuggestion[]>(`/budgets/suggestions${toQuery({ month })}`),

  rules: () => apiFetch<Rule[]>('/rules'),
  createRule: (body: CreateRuleRequest) => post<Rule>('/rules', body),
  deleteRule: (id: number) => del<{ ok: true }>(`/rules/${id}`),

  accounts: () => apiFetch<Account[]>('/accounts'),

  balance: () => apiFetch<BalanceSummary>('/balance'),
  createPot: (body: CreatePotRequest) => post<Pot>('/pots', body),
  deletePot: (categoryId: number) => del<{ ok: true }>(`/pots/${categoryId}`),
  syncStatus: () => apiFetch<SyncStatus>('/sync/status'),
  runSync: (full = false) => post<SyncResult>(`/sync${toQuery({ full: full ? 1 : undefined })}`),

  importPreview: (filename: string, content: string, accountId?: string) =>
    post<ImportPreview>('/import/preview', { filename, content, accountId }),
  importCommit: (token: string) => post<ImportResult>('/import/commit', { token }),

  pushStatus: () => apiFetch<PushStatus>('/push/status'),
  pushSubscribe: (body: PushSubscriptionInput) => post<{ ok: true }>('/push/subscribe', body),
  pushUnsubscribe: (endpoint: string) => post<{ ok: true }>('/push/unsubscribe', { endpoint }),
  pushTest: () => post<PushSendResult>('/push/test'),

  exportUrl: (month: string) => `/api/export${toQuery({ month })}`,
}
