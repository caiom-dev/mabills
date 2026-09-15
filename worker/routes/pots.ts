/**
 * Cofrinhos.
 *
 * Um cofrinho é uma CATEGORIA com uma linha em `pot_settings`. Categorizar um
 * lançamento como ela é o que move o dinheiro: sai da conta, entra no cofrinho.
 * Isso faz o motor de regras trabalhar de graça — "APLICACAO COFRINHOS" vira
 * uma regra e toda aplicação futura se classifica sozinha, venha do sync ou de
 * um OFX importado.
 *
 * O sinal é o mesmo que o app já usa para virar "gasto": aplicação é saída da
 * conta (amount negativo) e vira entrada no cofrinho, então o saldo soma
 * `-amount`. Resgate é o contrário, sem nenhum caso especial no código.
 */

import { Hono } from 'hono'
import type { BalanceSummary, Pot } from '@shared/types'
import { isValidDate, todayBrt } from '@shared/dates'
import { round2 } from '@shared/money'
import { apiError, badRequest, json, parseIdParam, readJson, type AppEnv } from '../http'

export const potRoutes = new Hono<AppEnv>()

/**
 * Saldo de cada cofrinho.
 *
 * O corte por `opening_date` não é detalhe: sem ele, um lançamento anterior à
 * abertura seria somado de novo a um valor que já o continha. Reimportar um
 * extrato antigo dobraria o saldo guardado.
 */
const POTS_SQL = `
  SELECT
    ps.category_id                         AS category_id,
    c.name                                 AS name,
    c.color_slot                           AS color_slot,
    ps.opening_balance                     AS opening_balance,
    ps.opening_date                        AS opening_date,
    ps.goal                                AS goal,
    ps.opening_balance
      + COALESCE(SUM(CASE WHEN t.id IS NULL THEN 0 ELSE -t.amount END), 0) AS balance,
    COALESCE(SUM(CASE WHEN t.id IS NULL THEN 0 ELSE 1 END), 0)             AS tx_count
  FROM pot_settings ps
  JOIN categories c ON c.id = ps.category_id
  LEFT JOIN transactions t
    ON t.category_id = ps.category_id
   AND t.date >= ps.opening_date
  WHERE c.is_archived = 0
  GROUP BY ps.category_id
  ORDER BY balance DESC, c.name
`

/**
 * Só conta corrente entra no "disponível".
 *
 * O saldo de uma conta de crédito é fatura em aberto — dívida, não dinheiro
 * disponível. Somá-la daria a alguém com R$ 2 mil de fatura a impressão de ter
 * R$ 2 mil a mais para gastar.
 */
const AVAILABLE_SQL = `
  SELECT COALESCE(SUM(balance), 0) AS available
  FROM accounts
  WHERE type = 'BANK' AND is_active = 1
`

interface PotRow {
  category_id: number
  name: string
  color_slot: number
  opening_balance: number
  opening_date: string
  goal: number | null
  balance: number
  tx_count: number
}

function toPot(row: PotRow): Pot {
  return {
    categoryId: Number(row.category_id),
    name: String(row.name),
    colorSlot: Number(row.color_slot ?? 0),
    balance: round2(Number(row.balance ?? 0)),
    openingBalance: round2(Number(row.opening_balance ?? 0)),
    openingDate: String(row.opening_date),
    goal: row.goal === null || row.goal === undefined ? null : round2(Number(row.goal)),
    txCount: Number(row.tx_count ?? 0),
  }
}

// ---------------------------------------------------------------------------
// GET /balance — a resposta da tela: quanto tenho de verdade, quanto guardado
// ---------------------------------------------------------------------------

potRoutes.get('/balance', async (c) => {
  const db = c.env.DB

  let pots: Pot[] = []
  try {
    const { results } = await db.prepare(POTS_SQL).all<PotRow>()
    pots = (results ?? []).map(toPot)
  } catch {
    // Banco sem a migration 0004 não pode derrubar a tela inicial: sem
    // cofrinho, "saldo total" é simplesmente o disponível.
    pots = []
  }

  const availableRow = await db.prepare(AVAILABLE_SQL).first<{ available: number }>()
  const available = round2(Number(availableRow?.available ?? 0))
  const inPots = round2(pots.reduce((soma, pot) => soma + pot.balance, 0))

  const body: BalanceSummary = {
    available,
    inPots,
    total: round2(available + inPots),
    pots,
  }
  return json(body)
})

// ---------------------------------------------------------------------------
// POST /pots — transforma uma categoria existente em cofrinho
// ---------------------------------------------------------------------------

interface CreatePotBody {
  categoryId?: number
  openingBalance?: number
  openingDate?: string
  goal?: number | null
}

potRoutes.post('/pots', async (c) => {
  const body = await readJson<CreatePotBody>(c)

  const categoryId = Number(body?.categoryId)
  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    badRequest('Informe a categoria que vai virar cofrinho.')
  }

  const opening = Number(body?.openingBalance ?? 0)
  if (!Number.isFinite(opening) || opening < 0) {
    badRequest('Saldo inicial inválido. Use um valor igual ou maior que zero.')
  }

  const openingDate = typeof body?.openingDate === 'string' ? body.openingDate : todayBrt()
  if (!isValidDate(openingDate)) badRequest('Data de abertura inválida. Use AAAA-MM-DD.')

  let goal: number | null = null
  if (body?.goal !== undefined && body.goal !== null) {
    goal = Number(body.goal)
    if (!Number.isFinite(goal) || goal <= 0) badRequest('Meta inválida. Use um valor positivo.')
  }

  const category = await c.env.DB.prepare('SELECT id, kind FROM categories WHERE id = ?')
    .bind(categoryId)
    .first<{ id: number; kind: string }>()
  if (!category) return apiError('Categoria não encontrada.', 404, { code: 'not_found' })

  /*
   * Cofrinho precisa ser do tipo transferência.
   *
   * Guardar dinheiro não é gastar: se a categoria continuasse como despesa, o
   * valor aplicado entraria no total do mês e o app diria que você gastou o que
   * apenas guardou — exatamente o erro que custou R$ 5 mil num mês real.
   */
  if (category.kind !== 'transfer') {
    await c.env.DB.prepare("UPDATE categories SET kind = 'transfer' WHERE id = ?")
      .bind(categoryId)
      .run()
  }

  await c.env.DB.prepare(
    `INSERT INTO pot_settings (category_id, opening_balance, opening_date, goal)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(category_id) DO UPDATE SET
       opening_balance = excluded.opening_balance,
       opening_date    = excluded.opening_date,
       goal            = excluded.goal,
       updated_at      = datetime('now')`,
  )
    .bind(categoryId, round2(opening), openingDate, goal)
    .run()

  const row = await c.env.DB.prepare(`${POTS_SQL.replace('WHERE c.is_archived = 0', 'WHERE c.is_archived = 0 AND ps.category_id = ?')}`)
    .bind(categoryId)
    .first<PotRow>()

  return json(row ? toPot(row) : { ok: true as const })
})

// ---------------------------------------------------------------------------
// DELETE /pots/:id — deixa de ser cofrinho; a categoria continua existindo
// ---------------------------------------------------------------------------

potRoutes.delete('/pots/:id', async (c) => {
  const categoryId = parseIdParam(c)

  const result = await c.env.DB.prepare('DELETE FROM pot_settings WHERE category_id = ?')
    .bind(categoryId)
    .run()

  if ((result.meta?.changes ?? 0) === 0) {
    return apiError('Essa categoria não é um cofrinho.', 404, { code: 'not_found' })
  }

  // A categoria fica como transferência: os lançamentos já classificados
  // continuam fora do total do mês, que é o comportamento correto para
  // aplicação e resgate mesmo sem o acompanhamento de saldo.
  return json({ ok: true as const })
})
