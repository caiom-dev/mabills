/**
 * Cliente HTTP do Pluggy.
 *
 * O SDK oficial (pluggy-sdk) depende de APIs nativas do Node e NAO roda em
 * Workers, entao falamos com a API por fetch() direto.
 *
 * Duas decisoes carregam este arquivo:
 *
 * 1. A apiKey vive no KV. Ela e um JWT de 2h; autenticar a cada requisicao
 *    gastaria um subrequest do orcamento (50 no plano gratuito) em toda chamada
 *    e ainda somaria latencia. Guardamos com TTL de 100 min - renovar cedo custa
 *    1 subrequest, usar um token vencido custa a sincronizacao inteira.
 * 2. Todo erro carrega status E corpo. Sem o corpo, depurar integracao vira
 *    adivinhacao: "HTTP 400" nao diz se o problema e a data, o cursor ou o item.
 */

import { PLUGGY_BASE_URL, PLUGGY_TOKEN_KEY, PLUGGY_TOKEN_TTL_SECONDS, type Env } from '../types'
import type {
  PluggyAccount,
  PluggyAccountsResponse,
  PluggyAuthResponse,
  PluggyItem,
  PluggyTransactionPage,
} from './pluggy-types'

/** Corpo de erro truncado: o suficiente para diagnosticar, sem poluir o log. */
const MAX_ERROR_BODY = 300

export class PluggyError extends Error {
  readonly status: number
  readonly body: string

  constructor(message: string, status: number, body: string) {
    super(message)
    this.name = 'PluggyError'
    this.status = status
    this.body = body
  }
}

// ---------------------------------------------------------------------------
// Configuracao
// ---------------------------------------------------------------------------

/**
 * Ids de item a partir da variavel separada por virgula.
 * O Set elimina repeticao: um id duplicado na variavel gastaria subrequests a
 * toa dentro de um orcamento que ja e apertado.
 */
export function parseItemIds(env: Env): string[] {
  const raw = env.PLUGGY_ITEM_IDS ?? ''
  return [...new Set(raw.split(',').map((part) => part.trim()).filter(Boolean))]
}

/** Sem os tres, o app segue funcionando so com import e lancamento manual. */
export function isConfigured(env: Env): boolean {
  return Boolean(env.PLUGGY_CLIENT_ID && env.PLUGGY_CLIENT_SECRET) && parseItemIds(env).length > 0
}

// ---------------------------------------------------------------------------
// Orcamento de subrequests
// ---------------------------------------------------------------------------

/**
 * Contador simples de subrequests.
 *
 * Existe porque a plataforma nao avisa: ao passar de 50 chamadas a requisicao e
 * abortada no meio, sem chance de gravar progresso. Reservando ANTES de cada
 * chamada, o sync para de forma limpa e a proxima execucao continua.
 */
export class SubrequestBudget {
  readonly limit: number
  #used = 0

  constructor(limit: number) {
    this.limit = limit
  }

  /** Reserva 1 subrequest. `false` = esgotado; pare, nao chame a rede. */
  take(): boolean {
    if (this.#used >= this.limit) return false
    this.#used += 1
    return true
  }

  get used(): number {
    return this.#used
  }

  get remaining(): number {
    return Math.max(0, this.limit - this.#used)
  }

  get exhausted(): boolean {
    return this.#used >= this.limit
  }
}

// ---------------------------------------------------------------------------
// Autenticacao
// ---------------------------------------------------------------------------

async function authenticate(env: Env): Promise<string> {
  const res = await fetch(`${PLUGGY_BASE_URL}/auth`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      clientId: env.PLUGGY_CLIENT_ID,
      clientSecret: env.PLUGGY_CLIENT_SECRET,
    }),
  })

  if (!res.ok) {
    const body = await readErrorBody(res)
    throw new PluggyError(
      `Falha ao autenticar no Pluggy (HTTP ${res.status}): ${body}`,
      res.status,
      body,
    )
  }

  const data = (await res.json()) as PluggyAuthResponse | null
  if (!data || typeof data.apiKey !== 'string' || !data.apiKey) {
    throw new PluggyError('Pluggy respondeu ao /auth sem apiKey.', res.status, '')
  }
  return data.apiKey
}

/**
 * apiKey do cache; autentica e grava no KV quando ausente.
 * `forceRefresh` e usado pela retentativa de 401.
 */
export async function getApiKey(env: Env, forceRefresh = false): Promise<string> {
  if (!forceRefresh) {
    const cached = await env.CACHE.get(PLUGGY_TOKEN_KEY)
    if (cached) return cached
  }

  const apiKey = await authenticate(env)
  await env.CACHE.put(PLUGGY_TOKEN_KEY, apiKey, { expirationTtl: PLUGGY_TOKEN_TTL_SECONDS })
  return apiKey
}

// ---------------------------------------------------------------------------
// Requisicoes
// ---------------------------------------------------------------------------

export type QueryParams = Record<string, string | number | null | undefined>

function buildUrl(path: string, params?: QueryParams): string {
  const url = new URL(path, PLUGGY_BASE_URL)
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue
      url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}

async function readErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text()
    return text.length > MAX_ERROR_BODY ? `${text.slice(0, MAX_ERROR_BODY)}...` : text
  } catch {
    return '<corpo ilegivel>'
  }
}

/**
 * Chamada autenticada. Injeta X-API-KEY (o Pluggy NAO usa Bearer).
 *
 * Um 401 quase sempre significa token vencido no KV, nao credencial errada:
 * invalidamos o cache e tentamos UMA vez com token novo. Essa retentativa gasta
 * ate 2 subrequests fora da conta do chamador - e uma das razoes de
 * SUBREQUEST_BUDGET (40) ficar abaixo do limite real da plataforma (50).
 */
export async function pluggyFetch<T>(env: Env, path: string, params?: QueryParams): Promise<T> {
  const url = buildUrl(path, params)

  let apiKey = await getApiKey(env)
  let res = await fetch(url, { headers: { 'X-API-KEY': apiKey } })

  if (res.status === 401) {
    await env.CACHE.delete(PLUGGY_TOKEN_KEY)
    apiKey = await getApiKey(env, true)
    res = await fetch(url, { headers: { 'X-API-KEY': apiKey } })
  }

  if (!res.ok) {
    const body = await readErrorBody(res)
    throw new PluggyError(`Pluggy ${path} respondeu HTTP ${res.status}: ${body}`, res.status, body)
  }

  return (await res.json()) as T
}

export function fetchItem(env: Env, itemId: string): Promise<PluggyItem> {
  return pluggyFetch<PluggyItem>(env, `/items/${encodeURIComponent(itemId)}`)
}

export async function fetchAccounts(env: Env, itemId: string): Promise<PluggyAccount[]> {
  const page = await pluggyFetch<PluggyAccountsResponse>(env, '/accounts', { itemId })
  return page?.results ?? []
}

export interface TransactionsPageQuery {
  accountId: string
  /** 'YYYY-MM-DD' */
  dateFrom: string
  /** 'YYYY-MM-DD' */
  dateTo: string
  /** Cursor devolvido em `next` pela pagina anterior. */
  after?: string | null
  pageSize?: number
}

/**
 * UMA pagina de transacoes.
 *
 * Usa /v2/transactions (cursor). O antigo /transactions com page/pageSize esta
 * depreciado e sai do ar em 31/12/2026. Quem itera e o sync, que precisa
 * decidir a cada pagina se ainda ha orcamento de subrequests.
 */
export async function fetchTransactionsPage(
  env: Env,
  query: TransactionsPageQuery,
): Promise<PluggyTransactionPage> {
  const page = await pluggyFetch<PluggyTransactionPage>(env, '/v2/transactions', {
    accountId: query.accountId,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    after: query.after ?? undefined,
    pageSize: query.pageSize,
  })
  return { results: page?.results ?? [], next: page?.next ?? null }
}
