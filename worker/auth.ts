/**
 * Autenticacao: PIN, sessao e limite de tentativas.
 *
 * A decisao central deste arquivo e o que ele NAO faz: nunca responde 302.
 *
 * O caminho obvio seria proteger o app com Cloudflare Access. Ele quebra PWA no
 * iPhone: quando o cookie do Access expira, os fetch() da SPA recebem um redirect
 * cross-origin, que o CORS transforma em erro opaco, e o app fica em tela branca
 * sem conseguir pedir login de novo. Aqui a API devolve 401 JSON e o proprio app
 * mostra a tela de PIN.
 *
 * O que realmente protege um PIN de 6 digitos nao e o custo de derivacao (sao so
 * 1 milhao de combinacoes), e o bloqueio por tentativas. Por isso o rate limit
 * abaixo nao e opcional.
 */

import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { MiddlewareHandler } from 'hono'
import type { LoginRequest } from '@shared/types'
import {
  LOGIN_LOCKOUT_SECONDS,
  LOGIN_MAX_ATTEMPTS,
  PBKDF2_ITERATIONS,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  type Env,
} from './types'
import { apiError, json, readJson, type AppContext, type AppEnv } from './http'

const encoder = new TextEncoder()

// ---------------------------------------------------------------------------
// Utilitarios de bytes
// ---------------------------------------------------------------------------

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (const byte of arr) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  return atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
}

/**
 * Comparacao em tempo constante.
 *
 * Um === entre hashes vaza informacao pelo tempo de resposta: quanto mais
 * prefixo em comum, mais tarde a comparacao falha. Com rate limit isso e dificil
 * de explorar, mas o custo de fazer certo e zero.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// ---------------------------------------------------------------------------
// PIN
// ---------------------------------------------------------------------------

/** Deriva o PIN com o mesmo algoritmo de scripts/hash-pin.mjs. */
export async function hashPin(pin: string, saltHex: string): Promise<string> {
  const salt = new Uint8Array(
    (saltHex.match(/.{1,2}/g) ?? []).map((byte) => Number.parseInt(byte, 16)),
  )
  const key = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  )
  return toHex(bits)
}

/** `stored` tem o formato "<salt_hex>:<hash_hex>", gerado por `npm run pin`. */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [saltHex, expected] = stored.split(':')
  if (!saltHex || !expected) return false
  const actual = await hashPin(pin, saltHex)
  return timingSafeEqual(actual, expected)
}

// ---------------------------------------------------------------------------
// Sessao
// ---------------------------------------------------------------------------

async function sign(env: Env, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env.SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  return base64UrlEncode(sig)
}

export async function createSession(env: Env): Promise<string> {
  const payload = base64UrlEncode(
    encoder.encode(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS })),
  )
  return `${payload}.${await sign(env, payload)}`
}

export async function verifySession(env: Env, token: string | undefined): Promise<boolean> {
  if (!token) return false
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return false

  // Confere a assinatura ANTES de olhar o conteudo: sem isso, um payload forjado
  // seria parseado e o exp poderia ser escolhido pelo atacante.
  if (!timingSafeEqual(await sign(env, payload), signature)) return false

  try {
    const data = JSON.parse(base64UrlDecode(payload)) as { exp?: number }
    return typeof data.exp === 'number' && data.exp > Math.floor(Date.now() / 1000)
  } catch {
    return false
  }
}

function issueCookie(c: AppContext, token: string): void {
  // O atributo Secure impede o cookie de ser salvo em http://localhost, o que
  // deixaria o login impossivel em desenvolvimento.
  const isHttps = new URL(c.req.url).protocol === 'https:'
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true, // imune a XSS, ao contrario de token em localStorage
    secure: isHttps,
    sameSite: 'Strict',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
}

// ---------------------------------------------------------------------------
// Limite de tentativas
// ---------------------------------------------------------------------------

interface AttemptRecord {
  count: number
  /** epoch em segundos ate quando o bloqueio vale. */
  until: number
}

function clientKey(c: AppContext): string {
  const ip =
    c.req.header('CF-Connecting-IP') ??
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ??
    'desconhecido'
  return `login:${ip}`
}

async function readAttempts(env: Env, key: string): Promise<AttemptRecord | null> {
  try {
    return await env.CACHE.get<AttemptRecord>(key, 'json')
  } catch {
    return null
  }
}

async function registerFailure(env: Env, key: string): Promise<void> {
  const current = (await readAttempts(env, key)) ?? { count: 0, until: 0 }
  const count = current.count + 1
  const record: AttemptRecord = {
    count,
    until: Math.floor(Date.now() / 1000) + LOGIN_LOCKOUT_SECONDS,
  }
  try {
    await env.CACHE.put(key, JSON.stringify(record), {
      expirationTtl: LOGIN_LOCKOUT_SECONDS,
    })
  } catch {
    // Falha no KV nao pode impedir a resposta; o pior caso e nao contar a tentativa.
  }
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE)
  if (!(await verifySession(c.env, token))) {
    return apiError('Sessão expirada.', 401, { code: 'unauthenticated' })
  }
  c.set('authed', true)
  await next()
  return undefined
}

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------

export const authRoutes = new Hono<AppEnv>()

authRoutes.post('/auth/login', async (c) => {
  if (!c.env.APP_PIN_HASH || !c.env.SESSION_SECRET) {
    return apiError(
      'App sem PIN configurado. Rode `npm run pin` e `npm run secret` e grave os segredos.',
      500,
      { code: 'not_configured' },
    )
  }

  const key = clientKey(c)
  const attempts = await readAttempts(c.env, key)
  const now = Math.floor(Date.now() / 1000)

  if (attempts && attempts.count >= LOGIN_MAX_ATTEMPTS && attempts.until > now) {
    const retryAfterSeconds = attempts.until - now
    return apiError('Muitas tentativas. Tente novamente mais tarde.', 429, {
      code: 'rate_limited',
      retryAfterSeconds,
    })
  }

  const body = await readJson<LoginRequest>(c)
  const pin = typeof body?.pin === 'string' ? body.pin : ''
  if (!pin) return apiError('Informe o PIN.', 400)

  if (!(await verifyPin(pin, c.env.APP_PIN_HASH))) {
    await registerFailure(c.env, key)
    // Nao revela quantas tentativas restam: isso so ajudaria quem esta chutando.
    return apiError('PIN incorreto.', 401, { code: 'invalid_pin' })
  }

  try {
    await c.env.CACHE.delete(key)
  } catch {
    // Limpar o contador e desejavel, nao critico.
  }

  issueCookie(c, await createSession(c.env))
  // c.json() e nao o helper json(): o helper monta uma Response nova e jogaria
  // fora o Set-Cookie que o issueCookie acabou de gravar no contexto.
  return c.json({ ok: true })
})

authRoutes.post('/auth/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  return c.json({ ok: true })
})

authRoutes.get('/auth/me', async (c) => {
  const authenticated = await verifySession(c.env, getCookie(c, SESSION_COOKIE))
  return json({ authenticated })
})
