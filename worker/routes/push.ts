/**
 * Inscricao e teste de notificacoes push.
 *
 * O aparelho se inscreve sozinho no servico de push (Apple, Google) e traz para
 * ca o endereco resultante mais duas chaves. Este arquivo so guarda esse
 * trio - quem cifra e entrega e o modulo push/.
 */

import { Hono } from 'hono'
import type { PushStatus, PushSubscriptionInput } from '@shared/types'
import { badRequest, json, readJson, type AppEnv } from '../http'
import { sendToAll } from '../push/send'
import { isPushConfigured } from '../push/vapid'

export const pushRoutes = new Hono<AppEnv>()

/** base64url de tamanho conhecido: 65 bytes viram 87 chars, 16 viram 22. */
const BASE64URL = /^[A-Za-z0-9_-]+$/

function requireKey(value: unknown, field: string, minLength: number): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text || text.length < minLength || !BASE64URL.test(text)) {
    badRequest(`Chave "${field}" da inscrição é inválida.`)
  }
  return text
}

pushRoutes.get('/push/status', async (c) => {
  const configured = isPushConfigured(c.env)

  let devices = 0
  try {
    const row = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM push_subscriptions',
    ).first<{ n: number }>()
    devices = Number(row?.n ?? 0)
  } catch {
    // Tabela ausente (banco sem a migration 0003) nao pode derrubar Ajustes.
    devices = 0
  }

  const status: PushStatus = {
    configured,
    // A chave publica vai para o navegador de proposito: e ela que o aparelho
    // usa em applicationServerKey. A privada nunca sai do Worker.
    publicKey: configured ? (c.env.VAPID_PUBLIC_KEY ?? null) : null,
    devices,
  }
  return json(status)
})

pushRoutes.post('/push/subscribe', async (c) => {
  if (!isPushConfigured(c.env)) {
    return json(
      { error: 'Notificações não estão configuradas neste servidor.', code: 'push_not_configured' },
      503,
    )
  }

  const body = await readJson<PushSubscriptionInput>(c)

  const endpoint = typeof body?.endpoint === 'string' ? body.endpoint.trim() : ''
  let origin: string
  try {
    origin = new URL(endpoint).protocol
  } catch {
    badRequest('Endereço de inscrição inválido.')
  }
  if (origin !== 'https:') badRequest('Endereço de inscrição precisa ser HTTPS.')

  const p256dh = requireKey(body?.keys?.p256dh, 'p256dh', 80)
  const auth = requireKey(body?.keys?.auth, 'auth', 16)

  // O mesmo aparelho reinscrito devolve o mesmo endpoint: atualizar em vez de
  // inserir evita duas linhas mandando a mesma notificacao para o mesmo iPhone.
  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES (?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET
       p256dh = excluded.p256dh,
       auth = excluded.auth,
       fail_count = 0`,
  )
    .bind(endpoint, p256dh, auth)
    .run()

  return json({ ok: true as const })
})

pushRoutes.post('/push/unsubscribe', async (c) => {
  const body = await readJson<{ endpoint?: string }>(c)
  const endpoint = typeof body?.endpoint === 'string' ? body.endpoint.trim() : ''
  if (!endpoint) badRequest('Endereço de inscrição ausente.')

  await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).run()
  return json({ ok: true as const })
})

/**
 * Notificacao de teste.
 *
 * Existe porque push e a unica parte do app que o usuario nao consegue conferir
 * sozinho: ou o iPhone apita, ou algo no meio do caminho falhou em silencio.
 */
pushRoutes.post('/push/test', async (c) => {
  const result = await sendToAll(c.env, {
    title: 'MaBills',
    body: 'Notificações ativadas. É assim que os alertas de gasto vão chegar.',
    url: '/',
    tag: 'test',
  })
  return json(result)
})
