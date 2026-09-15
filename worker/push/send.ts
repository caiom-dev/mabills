/**
 * Entrega das notificacoes.
 *
 * Como o resto do sync, NADA aqui lanca para fora: falhar em notificar nao pode
 * derrubar o cron que acabou de importar os lancamentos do dia. Um endpoint
 * morto e estado normal - o usuario desinstalou o PWA, restaurou o iPhone,
 * limpou os dados do Safari - e o tratamento certo e apagar a inscricao, nao
 * tentar de novo amanha para sempre.
 */

import type { Env } from '../types'
import { PUSH_MAX_ENDPOINTS, PUSH_TTL_SECONDS } from '../types'
import { encryptPayload, MAX_PAYLOAD_BYTES } from './crypto'
import { isPushConfigured, vapidAuthorization } from './vapid'

export interface PushMessage {
  title: string
  body: string
  /** Caminho aberto ao tocar na notificacao. */
  url?: string
  /**
   * Agrupador. Duas notificacoes com a mesma tag se substituem no aparelho em
   * vez de empilhar - e o que impede a tela de bloqueio virar uma pilha de
   * avisos sobre a mesma categoria.
   */
  tag?: string
}

export interface PushSendResult {
  sent: number
  /** Inscricoes apagadas por terem respondido 404/410. */
  removed: number
  failed: number
}

interface SubscriptionRow {
  endpoint: string
  p256dh: string
  auth: string
}

const EMPTY: PushSendResult = { sent: 0, removed: 0, failed: 0 }

/**
 * Envia para um endpoint.
 *
 * Devolve 'gone' quando o servico de push diz que a inscricao morreu, o que o
 * chamador traduz em DELETE.
 */
async function sendOne(
  env: Env,
  row: SubscriptionRow,
  message: PushMessage,
): Promise<'sent' | 'gone' | 'failed'> {
  try {
    const payload = JSON.stringify(message)
    if (payload.length > MAX_PAYLOAD_BYTES) return 'failed'

    const body = await encryptPayload(payload, { p256dh: row.p256dh, auth: row.auth })

    const response = await fetch(row.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidAuthorization(env, row.endpoint),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(PUSH_TTL_SECONDS),
        Urgency: 'normal',
      },
      body: body as BodyInit,
    })

    if (response.ok) return 'sent'
    // 404 = endpoint nunca existiu; 410 = foi revogado. Ambos sao definitivos.
    if (response.status === 404 || response.status === 410) return 'gone'
    return 'failed'
  } catch {
    return 'failed'
  }
}

/**
 * Envia a mensagem para todos os aparelhos inscritos.
 *
 * O limite de aparelhos existe por causa do teto de 50 subrequests por
 * invocacao do plano gratuito: no cron esta funcao roda depois do sync, que ja
 * gastou parte do orcamento.
 */
export async function sendToAll(env: Env, message: PushMessage): Promise<PushSendResult> {
  if (!isPushConfigured(env)) return EMPTY

  let rows: SubscriptionRow[]
  try {
    const result = await env.DB.prepare(
      `SELECT endpoint, p256dh, auth FROM push_subscriptions
       ORDER BY created_at LIMIT ${PUSH_MAX_ENDPOINTS}`,
    ).all<SubscriptionRow>()
    rows = result.results ?? []
  } catch {
    return EMPTY
  }

  if (rows.length === 0) return EMPTY

  const outcomes = await Promise.all(rows.map((row) => sendOne(env, row, message)))

  const gone: string[] = []
  const sentTo: string[] = []
  let failed = 0
  for (let i = 0; i < rows.length; i++) {
    const endpoint = (rows[i] as SubscriptionRow).endpoint
    if (outcomes[i] === 'gone') gone.push(endpoint)
    else if (outcomes[i] === 'sent') sentTo.push(endpoint)
    else failed++
  }

  try {
    const statements = []
    if (gone.length > 0) {
      statements.push(
        env.DB.prepare(
          `DELETE FROM push_subscriptions WHERE endpoint IN (${gone.map(() => '?').join(',')})`,
        ).bind(...gone),
      )
    }
    if (sentTo.length > 0) {
      statements.push(
        env.DB.prepare(
          `UPDATE push_subscriptions SET last_sent_at = datetime('now'), fail_count = 0
           WHERE endpoint IN (${sentTo.map(() => '?').join(',')})`,
        ).bind(...sentTo),
      )
    }
    if (statements.length > 0) await env.DB.batch(statements)
  } catch {
    // A contabilidade da inscricao e secundaria: a notificacao ja foi entregue.
  }

  return { sent: sentTo.length, removed: gone.length, failed }
}
