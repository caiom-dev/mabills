/**
 * Assinatura VAPID: prova ao servico de push que a mensagem veio deste servidor.
 *
 * O cabecalho `Authorization: vapid t=<JWT>, k=<chave publica>` e o que separa
 * um push legitimo de qualquer um que tenha descoberto a URL do endpoint. O JWT
 * e assinado com a chave privada cujo par publico o aparelho registrou na
 * inscricao - sem ela o servico de push responde 403.
 */

import type { Env } from '../types'
import { VAPID_JWT_TTL_SECONDS } from '../types'
import { bytesToB64url, importVapidSigningKey } from './crypto'

const encoder = new TextEncoder()

function b64urlJson(value: unknown): string {
  return bytesToB64url(encoder.encode(JSON.stringify(value)))
}

/**
 * Cache por invocacao.
 *
 * O `aud` do JWT e a origem do servico de push, entao todos os iPhones de um
 * mesmo usuario compartilham o mesmo token. Assinar uma vez por invocacao em
 * vez de uma vez por aparelho economiza CPU justamente no cron, que e onde o
 * orcamento de 10ms aperta.
 */
const jwtCache = new Map<string, { token: string; expiresAt: number }>()

async function signedJwt(env: Env, audience: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const cached = jwtCache.get(audience)
  if (cached && cached.expiresAt > now + 60) return cached.token

  const expiresAt = now + VAPID_JWT_TTL_SECONDS
  const signingInput = `${b64urlJson({ typ: 'JWT', alg: 'ES256' })}.${b64urlJson({
    aud: audience,
    exp: expiresAt,
    sub: env.VAPID_SUBJECT || 'mailto:mabills@example.com',
  })}`

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    await importVapidSigningKey(env.VAPID_PUBLIC_KEY ?? '', env.VAPID_PRIVATE_KEY ?? ''),
    encoder.encode(signingInput),
  )

  const token = `${signingInput}.${bytesToB64url(signature)}`
  jwtCache.set(audience, { token, expiresAt })
  return token
}

/** Valor pronto do cabecalho Authorization para um endpoint de push. */
export async function vapidAuthorization(env: Env, endpoint: string): Promise<string> {
  const audience = new URL(endpoint).origin
  const token = await signedJwt(env, audience)
  return `vapid t=${token}, k=${env.VAPID_PUBLIC_KEY}`
}

/** Push so funciona com o par de chaves configurado - igual ao Pluggy. */
export function isPushConfigured(env: Env): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY)
}
