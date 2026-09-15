/**
 * Helpers de HTTP compartilhados por todas as rotas do Worker.
 *
 * Tres decisoes valem para a API inteira:
 *
 *  1. Toda resposta e JSON, inclusive erro. O app e um PWA instalado na tela de
 *     inicio do iPhone: se a API respondesse 302 para a tela de login, o fetch
 *     seguiria o redirect e o React receberia HTML no lugar de dados. Por isso
 *     sessao invalida e 401 com corpo JSON, nunca redirect.
 *  2. Toda resposta de API vai com Cache-Control: no-store. O service worker do
 *     PWA guarda GET por padrao, e extrato em cache e numero errado na tela.
 *  3. Erro de validacao e lancado como HttpError e convertido em resposta pelo
 *     onError do app. Isso deixa os parsers usaveis no meio de uma expressao
 *     (`const month = parseMonthParam(c)`) sem cada rota ter que checar null.
 */

import type { Context } from 'hono'
import type { ApiError } from '@shared/types'
import { currentMonth, isValidDate, isValidMonth } from '@shared/dates'
import type { Env } from './types'

// ---------------------------------------------------------------------------
// Tipos do Hono
// ---------------------------------------------------------------------------

/** Ambiente tipado do app. `authed` so existe depois do requireAuth. */
export type AppEnv = { Bindings: Env; Variables: { authed: true } }

/** Atalho para o contexto ja tipado, usado nas assinaturas dos helpers. */
export type AppContext = Context<AppEnv>

// ---------------------------------------------------------------------------
// Respostas
// ---------------------------------------------------------------------------

const BASE_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
}

/** Resposta JSON. Use no lugar de c.json() para manter os cabecalhos padrao. */
export function json<T>(data: T, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...BASE_HEADERS, ...headers },
  })
}

export interface ApiErrorExtra {
  code?: string
  retryAfterSeconds?: number
  headers?: Record<string, string>
}

/** Erro no formato ApiError. `message` e texto para o usuario, em portugues. */
export function apiError(message: string, status: number, extra: ApiErrorExtra = {}): Response {
  const body: ApiError = { error: message }
  if (extra.code) body.code = extra.code

  const headers: Record<string, string> = { ...extra.headers }
  if (typeof extra.retryAfterSeconds === 'number') {
    const seconds = Math.max(0, Math.ceil(extra.retryAfterSeconds))
    body.retryAfterSeconds = seconds
    headers['Retry-After'] = String(seconds)
  }

  return json(body, status, headers)
}

/**
 * Erro que vira resposta HTTP. Lancado pelos parsers e por qualquer rota que
 * queira abortar no meio de uma expressao; o onError do app converte em JSON.
 */
export class HttpError extends Error {
  readonly status: number
  readonly code: string | undefined
  readonly retryAfterSeconds: number | undefined

  constructor(message: string, status: number, extra: ApiErrorExtra = {}) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = extra.code
    this.retryAfterSeconds = extra.retryAfterSeconds
  }

  toResponse(): Response {
    const extra: ApiErrorExtra = {}
    if (this.code !== undefined) extra.code = this.code
    if (this.retryAfterSeconds !== undefined) extra.retryAfterSeconds = this.retryAfterSeconds
    return apiError(this.message, this.status, extra)
  }
}

/** Aborta com 400 padronizado. Devolve `never`, entao pode fechar uma expressao. */
export function badRequest(message: string): never {
  throw new HttpError(message, 400, { code: 'bad_request' })
}

/** Aborta com 404 padronizado. */
export function notFound(message: string): never {
  throw new HttpError(message, 404, { code: 'not_found' })
}

// ---------------------------------------------------------------------------
// Corpo da requisicao
// ---------------------------------------------------------------------------

/**
 * Le o corpo como objeto JSON. JSON quebrado vira 400 (e nao 500 vindo do
 * SyntaxError cru do runtime).
 */
export async function readJson<T>(c: AppContext): Promise<T> {
  let parsed: unknown
  try {
    parsed = await c.req.json()
  } catch {
    throw new HttpError('Corpo da requisição precisa ser JSON válido.', 400, { code: 'bad_json' })
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError('Corpo da requisição precisa ser um objeto JSON.', 400, { code: 'bad_json' })
  }
  return parsed as T
}

// ---------------------------------------------------------------------------
// Query string
// ---------------------------------------------------------------------------

/** Corta o eco do valor invalido: mensagem de erro nao e lugar de despejar entrada. */
function preview(raw: string): string {
  return raw.length > 24 ? `${raw.slice(0, 24)}...` : raw
}

/**
 * ?month=AAAA-MM. Sem o parametro devolve o mes corrente em Brasilia quando
 * `fallbackToCurrent`; caso contrario exige o valor.
 */
export function parseMonthParam(c: AppContext, fallbackToCurrent = true): string {
  const raw = c.req.query('month')?.trim()
  if (!raw) {
    if (fallbackToCurrent) return currentMonth()
    badRequest('Informe o mês no formato AAAA-MM.')
  }
  if (!isValidMonth(raw)) {
    badRequest(`Mês inválido: ${preview(raw)}. Use o formato AAAA-MM.`)
  }
  return raw
}

/** ?from=AAAA-MM-DD e afins. */
export function parseDateParam(c: AppContext, name: string): string | null {
  const raw = c.req.query(name)?.trim()
  if (!raw) return null
  if (!isValidDate(raw)) {
    badRequest(`Data inválida em "${name}": ${preview(raw)}. Use o formato AAAA-MM-DD.`)
  }
  return raw
}

export interface IntParamOptions {
  /** Valor usado quando o parametro nao vem na URL. */
  fallback?: number
  /** Limites; valores fora da faixa sao ajustados, nao rejeitados. */
  min?: number
  max?: number
}

export function parseIntParam(
  c: AppContext,
  name: string,
  options: IntParamOptions & { fallback: number },
): number
export function parseIntParam(c: AppContext, name: string, options?: IntParamOptions): number | null
export function parseIntParam(
  c: AppContext,
  name: string,
  options: IntParamOptions = {},
): number | null {
  const raw = c.req.query(name)?.trim()
  if (!raw) return options.fallback ?? null

  const n = Number(raw)
  if (!Number.isInteger(n)) {
    badRequest(`Parâmetro "${name}" precisa ser um número inteiro (recebido: ${preview(raw)}).`)
  }
  return clamp(n, options.min, options.max)
}

/**
 * Id numerico vindo do caminho (/categories/:id). Erro aqui e 400, nao 404:
 * "abc" nunca foi um id valido.
 */
export function parseIdParam(c: AppContext, name = 'id'): number {
  const raw = c.req.param(name)
  const n = Number(raw)
  if (!raw || !Number.isInteger(n) || n <= 0) {
    badRequest(`Identificador inválido: ${preview(String(raw ?? ''))}.`)
  }
  return n
}

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'sim'])
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off', 'nao', 'não'])

/** ?uncategorized=1. Valor irreconhecivel cai no fallback em vez de derrubar a rota. */
export function parseBoolParam(c: AppContext, name: string, fallback = false): boolean {
  const raw = c.req.query(name)?.trim().toLowerCase()
  if (!raw) return fallback
  if (TRUE_VALUES.has(raw)) return true
  if (FALSE_VALUES.has(raw)) return false
  return fallback
}

/** ?q=texto, ja aparado e limitado - vira LIKE, entao nao pode ser gigante. */
export function parseStringParam(c: AppContext, name: string, maxLength = 120): string | null {
  const raw = c.req.query(name)?.trim()
  if (!raw) return null
  return raw.slice(0, maxLength)
}

function clamp(n: number, min?: number, max?: number): number {
  let out = n
  if (typeof min === 'number' && out < min) out = min
  if (typeof max === 'number' && out > max) out = max
  return out
}
