/**
 * Decide o que merece virar notificacao depois do sync.
 *
 * A regra que define o produto: avisar ANTES do estouro, e avisar UMA vez.
 * Um alerta que repete todo dia ate o mes virar ensina o usuario a ignorar a
 * notificacao - e ai ela nao serve mais para nada quando importa.
 *
 * Por isso cada par (categoria, mes, estado) so notifica uma vez. Uma categoria
 * gera no maximo dois avisos no mes: um ao passar de 80% do teto, outro ao
 * estourar.
 */

import type { BudgetProgress } from '@shared/types'
import { currentMonth } from '@shared/dates'
import { formatBRL } from '@shared/money'
import type { Env } from '../types'
import { computeBudgetProgress } from '../routes/summary'
import { sendToAll, type PushSendResult } from './send'
import { isPushConfigured } from './vapid'

/** Estados que viram aviso, do mais grave para o menos. */
const ALERT_STATES = new Set<BudgetProgress['state']>(['estourado', 'atencao'])

const EMPTY: PushSendResult = { sent: 0, removed: 0, failed: 0 }

interface PendingAlert {
  categoryId: number
  state: string
  name: string
  spent: number
  limit: number
}

/** Texto de UMA categoria: o que aconteceu e o numero que importa. */
function describe(alert: PendingAlert): string {
  if (alert.state === 'estourado') {
    return `${alert.name} estourou ${formatBRL(alert.spent - alert.limit)} acima do teto`
  }
  return `${alert.name}: ${formatBRL(alert.limit - alert.spent)} restantes do teto`
}

function buildMessage(alerts: PendingAlert[]): { title: string; body: string } {
  const burst = alerts.filter((a) => a.state === 'estourado')

  if (alerts.length === 1) {
    const only = alerts[0] as PendingAlert
    return {
      title: only.state === 'estourado' ? 'Teto estourado' : 'Perto do teto',
      body: describe(only),
    }
  }

  return {
    title: burst.length > 0 ? `${burst.length} categoria(s) estouraram` : 'Categorias perto do teto',
    // Tres linhas no maximo: a notificacao do iOS corta o resto, e a lista
    // completa esta no app a um toque de distancia.
    body: alerts.slice(0, 3).map(describe).join('\n'),
  }
}

/**
 * Avalia o mes corrente e notifica o que ainda nao foi notificado.
 *
 * Nunca lanca: e chamada pelo cron, onde nao ha usuario esperando resposta e
 * uma excecao morreria silenciosa de qualquer forma.
 */
export async function sendBudgetAlerts(env: Env): Promise<PushSendResult & { alerted: number }> {
  if (!isPushConfigured(env)) return { ...EMPTY, alerted: 0 }

  try {
    const month = currentMonth()
    const progress = await computeBudgetProgress(env.DB, month)

    const candidates: PendingAlert[] = progress
      .filter((b) => ALERT_STATES.has(b.state) && b.limitAmount !== null)
      .map((b) => ({
        categoryId: b.categoryId,
        state: b.state,
        name: b.categoryName,
        spent: b.spent,
        limit: b.limitAmount as number,
      }))

    if (candidates.length === 0) return { ...EMPTY, alerted: 0 }

    // Grava ANTES de enviar. Se o envio falhar o usuario perde um aviso; se a
    // ordem fosse inversa, uma falha ao gravar faria a mesma notificacao sair
    // de novo a cada execucao do cron.
    const inserts = candidates.map((alert) =>
      env.DB.prepare(
        `INSERT INTO push_alerts (category_id, month, state) VALUES (?, ?, ?)
         ON CONFLICT(category_id, month, state) DO NOTHING`,
      ).bind(alert.categoryId, month, alert.state),
    )
    const results = await env.DB.batch(inserts)

    // Só notifica o que a UNIQUE aceitou: linha ignorada = ja avisado antes.
    const fresh = candidates.filter((_, i) => (results[i]?.meta?.changes ?? 0) > 0)
    if (fresh.length === 0) return { ...EMPTY, alerted: 0 }

    const { title, body } = buildMessage(fresh)
    const result = await sendToAll(env, {
      title,
      body,
      url: '/categorias',
      // Uma tag por mes: um aviso novo substitui o anterior na tela de bloqueio
      // em vez de empilhar.
      tag: `budget-${month}`,
    })

    return { ...result, alerted: fresh.length }
  } catch {
    return { ...EMPTY, alerted: 0 }
  }
}
