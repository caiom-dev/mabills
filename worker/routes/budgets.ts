/**
 * Tetos de gasto.
 *
 * O mes '*' e o teto recorrente padrao: configura-se uma vez e vale para todos
 * os meses; uma linha com 'AAAA-MM' sobrescreve apenas aquele mes. O progresso
 * vem de computeBudgetProgress (summary.ts) para que /summary e /budgets nunca
 * divirjam no calculo.
 */

import { Hono } from 'hono'

import type { BudgetSuggestion, UpsertBudgetRequest } from '@shared/types'
import { addMonths, isValidMonth, monthBounds } from '@shared/dates'
import { round2 } from '@shared/money'

import { json, badRequest, apiError, parseMonthParam, type AppEnv } from '../http'
import { computeBudgetProgress } from './summary'

const MONTH_HELP = "Parâmetro 'month' inválido. Use o formato AAAA-MM (ex.: 2026-08)."
const BUDGET_MONTH_HELP =
  "Campo 'month' inválido. Use o formato AAAA-MM ou '*' para o teto padrão recorrente."

/** Meses olhados para tras ao sugerir um teto. */
const SUGGESTION_WINDOW_MONTHS = 3

const SUGGESTIONS_SQL = `
  SELECT t.category_id AS category_id,
         c.name AS category_name,
         substr(t.date, 1, 7) AS month,
         SUM(-t.amount) AS spent
  FROM transactions t
  JOIN categories c ON c.id = t.category_id
  WHERE t.date >= ?1 AND t.date <= ?2
    AND t.amount < 0 AND t.is_ignored = 0
    AND c.kind = 'expense' AND c.is_archived = 0
  GROUP BY t.category_id, month
  HAVING SUM(-t.amount) > 0
`

const UPSERT_SQL = `
  INSERT INTO budgets (category_id, month, limit_amount)
  VALUES (?1, ?2, ?3)
  ON CONFLICT(category_id, month) DO UPDATE SET limit_amount = excluded.limit_amount
`

interface SuggestionRow {
  category_id: number
  category_name: string
  month: string
  spent: number
}

/** '*' e um mes valido aqui: e o teto recorrente padrao. */
function isBudgetMonth(month: string): boolean {
  return month === '*' || isValidMonth(month)
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function parseCategoryId(raw: string | undefined): number | null {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

/**
 * Um numero redondo e mais facil de aceitar do que "R$ 487,33" - e aceitar a
 * sugestao e justamente o passo que trava quem nunca definiu um teto.
 */
function roundToTen(value: number): number {
  const rounded = Math.round(value / 10) * 10
  // Sugerir zero para quem gastou alguma coisa nao ajuda ninguem.
  return rounded === 0 && value > 0 ? 10 : rounded
}

export const budgetRoutes = new Hono<AppEnv>()

budgetRoutes.get('/budgets/suggestions', async (c) => {
  const month = parseMonthParam(c)
  if (!month || !isValidMonth(month)) return badRequest(MONTH_HELP)

  const from = monthBounds(addMonths(month, -SUGGESTION_WINDOW_MONTHS)).from
  const to = monthBounds(addMonths(month, -1)).to

  const { results } = await c.env.DB.prepare(SUGGESTIONS_SQL).bind(from, to).all<SuggestionRow>()

  // Media apenas sobre os meses em que a categoria teve movimento: incluir um
  // mes zerado derrubaria a sugestao para algo que o usuario nunca cumpriria.
  const acc = new Map<number, { name: string; total: number; months: number }>()
  for (const row of results) {
    const current = acc.get(row.category_id)
    if (current) {
      current.total += row.spent
      current.months += 1
    } else {
      acc.set(row.category_id, { name: row.category_name, total: row.spent, months: 1 })
    }
  }

  const suggestions: BudgetSuggestion[] = []
  for (const [categoryId, data] of acc) {
    suggestions.push({
      categoryId,
      categoryName: data.name,
      suggested: roundToTen(data.total / data.months),
      monthsConsidered: data.months,
    })
  }
  suggestions.sort((a, b) => b.suggested - a.suggested)

  return json(suggestions)
})

budgetRoutes.get('/budgets', async (c) => {
  const month = parseMonthParam(c)
  if (!month || !isValidMonth(month)) return badRequest(MONTH_HELP)

  return json(await computeBudgetProgress(c.env.DB, month))
})

budgetRoutes.put('/budgets', async (c) => {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    return badRequest('Corpo da requisição inválido: envie um JSON.')
  }

  const body = asObject(raw)
  if (!body) return badRequest('Corpo da requisição inválido: envie um objeto JSON.')

  const categoryId = body.categoryId
  if (typeof categoryId !== 'number' || !Number.isInteger(categoryId) || categoryId <= 0) {
    return badRequest("Campo 'categoryId' inválido: informe o id de uma categoria.")
  }

  const month = body.month
  if (typeof month !== 'string' || !isBudgetMonth(month)) {
    return badRequest(BUDGET_MONTH_HELP)
  }

  const limitAmount = body.limitAmount
  if (typeof limitAmount !== 'number' || !Number.isFinite(limitAmount) || limitAmount < 0) {
    return badRequest(
      "Campo 'limitAmount' inválido: informe um valor maior ou igual a zero. Para remover o teto, apague o orçamento.",
    )
  }

  const category = await c.env.DB.prepare('SELECT id, kind FROM categories WHERE id = ?1')
    .bind(categoryId)
    .first<{ id: number; kind: string }>()

  if (!category) return apiError('Categoria não encontrada.', 404, { code: 'category_not_found' })
  // Teto em categoria de renda ou transferencia nunca apareceria no progresso
  // (a consulta so olha kind='expense'), entao seria um ajuste silencioso a toa.
  if (category.kind !== 'expense') {
    return badRequest('Só é possível definir teto para categorias de despesa.')
  }

  const payload: UpsertBudgetRequest = { categoryId, month, limitAmount: round2(limitAmount) }
  await c.env.DB.prepare(UPSERT_SQL)
    .bind(payload.categoryId, payload.month, payload.limitAmount)
    .run()

  return json({ ok: true })
})

budgetRoutes.delete('/budgets/:categoryId', async (c) => {
  const categoryId = parseCategoryId(c.req.param('categoryId'))
  if (categoryId === null) {
    return badRequest("Parâmetro 'categoryId' inválido: informe o id de uma categoria.")
  }

  // Sem month, apaga o teto padrao - que e o caso comum de "nao quero mais
  // acompanhar esta categoria".
  const month = c.req.query('month') || '*'
  if (!isBudgetMonth(month)) return badRequest(BUDGET_MONTH_HELP)

  await c.env.DB.prepare('DELETE FROM budgets WHERE category_id = ?1 AND month = ?2')
    .bind(categoryId, month)
    .run()

  return json({ ok: true })
})
