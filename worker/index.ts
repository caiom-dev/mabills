/**
 * Ponto de entrada do Worker: API em /api e o cron diario.
 *
 * O app estatico e servido pelo binding de assets na MESMA origem, o que elimina
 * CORS e deixa o cookie de sessao ser SameSite=Strict. O wrangler.toml usa
 * `run_worker_first = ["/api/*"]`; sem isso o fallback de SPA responderia
 * index.html para /api/* e a API nunca seria alcancada.
 */

import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { apiError, HttpError, type AppEnv } from './http'
import { authRoutes, requireAuth } from './auth'
import { summaryRoutes } from './routes/summary'
import { budgetRoutes } from './routes/budgets'
import { categoryRoutes } from './routes/categories'
import { transactionRoutes } from './routes/transactions'
import { ruleRoutes } from './routes/rules'
import { syncRoutes } from './routes/sync'
import { importRoutes } from './routes/import'
import { pushRoutes } from './routes/push'
import { potRoutes } from './routes/pots'
import { runSync } from './pluggy/sync'
import { sendBudgetAlerts } from './push/alerts'
import type { Env } from './types'

const app = new Hono<AppEnv>().basePath('/api')

// Auth vem antes do middleware: login e /me precisam ser alcancaveis sem sessao.
app.route('/', authRoutes)

app.use('*', requireAuth)

app.route('/', summaryRoutes)
app.route('/', budgetRoutes)
app.route('/', categoryRoutes)
app.route('/', transactionRoutes)
app.route('/', ruleRoutes)
app.route('/', syncRoutes)
app.route('/', importRoutes)
app.route('/', pushRoutes)
app.route('/', potRoutes)

/** 404 de API responde JSON. HTML aqui viraria erro de parse no cliente. */
app.notFound(() => apiError('Rota não encontrada.', 404, { code: 'not_found' }))

app.onError((err) => {
  if (err instanceof HttpError) {
    return err.toResponse()
  }
  if (err instanceof HTTPException) {
    return apiError(err.message || 'Erro na requisição.', err.status)
  }
  console.error('Erro nao tratado:', err)
  return apiError('Erro interno. Tente novamente.', 500, { code: 'internal' })
})

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api')) {
      return app.fetch(request, env, ctx)
    }
    // Rede de seguranca: em producao os assets sao servidos antes do Worker,
    // mas essa rota existe para o caso de a requisicao chegar aqui mesmo assim.
    if (env.ASSETS) return env.ASSETS.fetch(request)
    return new Response('Not found', { status: 404 })
  },

  /**
   * Cron diario.
   *
   * O Meu Pluggy atualiza os dados uma vez por dia, entao sincronizar com mais
   * frequencia so gastaria requisicao sem trazer dado novo.
   *
   * O try/catch existe porque uma excecao aqui morre silenciosa: nao ha usuario
   * esperando resposta. O runSync ja grava em sync_log, que e o que a tela de
   * Ajustes le para mostrar "última sincronização".
   */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runSync(env, 'cron')
        .then(() =>
          // Os alertas saem DEPOIS do sync, e so dele: avaliar o orcamento antes
          // de importar os lancamentos do dia avisaria com o numero de ontem.
          // sendBudgetAlerts nunca lanca, entao nao ha catch proprio aqui.
          sendBudgetAlerts(env),
        )
        .catch((err) => {
          console.error('Falha no sync agendado:', err)
        }),
    )
  },
}
