/**
 * Rotas de sincronizacao.
 *
 * Regra que atravessa o arquivo: NADA aqui pode lancar excecao para fora.
 * Um sync que falha e um estado normal (banco fora do ar, item precisando de
 * reconexao) e precisa virar informacao na tela de Ajustes, nao um 500 mudo que
 * deixa o usuario achando que o app esta atualizado quando nao esta.
 */

import { Hono } from 'hono'
import type { Account, SyncStatus } from '@shared/types'
import { json, type AppEnv } from '../http'
import { listAccounts, rowToAccount, type Row } from '../db'
import { isConfigured, parseItemIds, fetchItem } from '../pluggy/client'
import { runSync } from '../pluggy/sync'

export const syncRoutes = new Hono<AppEnv>()

/** Status que exigem acao do usuario no meu.pluggy.ai. */
const BROKEN_ITEM_STATUS = new Set([
  'LOGIN_ERROR',
  'WAITING_USER_INPUT',
  'INVALID_CREDENTIALS',
  'ACCOUNT_LOCKED',
  'OUTDATED',
])

syncRoutes.get('/sync/status', async (c) => {
  const db = c.env.DB

  const last = await db
    .prepare(
      `SELECT started_at, finished_at, status, error
       FROM sync_log ORDER BY id DESC LIMIT 1`,
    )
    .first<Row>()

  let accounts: Account[] = []
  try {
    accounts = await listAccounts(db)
  } catch {
    accounts = []
  }

  const status: SyncStatus = {
    lastSyncAt: last ? ((last.finished_at ?? last.started_at) as string) : null,
    lastStatus: (last?.status as SyncStatus['lastStatus']) ?? null,
    lastError: (last?.error as string | null) ?? null,
    itemIssues: [],
    configured: isConfigured(c.env),
    accounts,
  }

  if (status.configured) {
    for (const itemId of parseItemIds(c.env)) {
      try {
        const item = await fetchItem(c.env, itemId)
        if (BROKEN_ITEM_STATUS.has(item.status)) {
          status.itemIssues.push({
            itemId,
            status: item.status,
            message:
              item.error?.message ??
              'Conexão precisa ser refeita em meu.pluggy.ai para a sincronização voltar.',
          })
        }
      } catch (err) {
        // Consultar o Pluggy pode falhar; isso nao pode derrubar a tela de
        // Ajustes, que e justamente onde o usuario vai descobrir o problema.
        status.itemIssues.push({
          itemId,
          status: 'UNKNOWN',
          message: err instanceof Error ? err.message : 'Falha ao consultar o Pluggy.',
        })
      }
    }
  }

  return json(status)
})

syncRoutes.post('/sync', async (c) => {
  const full = c.req.query('full') === '1'
  try {
    return json(await runSync(c.env, 'manual', { fullBackfill: full }))
  } catch (err) {
    const now = new Date().toISOString()
    return json({
      status: 'error' as const,
      inserted: 0,
      updated: 0,
      accountsSynced: 0,
      startedAt: now,
      finishedAt: now,
      errors: [err instanceof Error ? err.message : 'Falha inesperada na sincronização.'],
    })
  }
})

syncRoutes.get('/accounts', async (c) => json(await listAccounts(c.env.DB)))

export { rowToAccount }
