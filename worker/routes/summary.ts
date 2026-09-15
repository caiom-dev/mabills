/**
 * Leituras agregadas: resumo do mes, quebra por categoria e tendencia.
 *
 * /summary e a tela que abre em toda sessao, entao ela sai de UM unico
 * db.batch: quatro consultas, uma ida ao D1, uma subrequest. O plano gratuito
 * da 10ms de CPU por invocacao - a agregacao pesada fica no SQLite e o
 * JavaScript so monta o objeto de resposta.
 */

import { Hono } from 'hono'

import type {
  BudgetProgress,
  BudgetState,
  CategoryBreakdown,
  MonthSummary,
  MonthTrend,
  Pace,
  PaceStatus,
  Transaction,
} from '@shared/types'
import { addMonths, currentMonth, isValidMonth, monthBounds, monthProgress } from '@shared/dates'
import { round2 } from '@shared/money'

import { BUDGET_WARN_THRESHOLD } from '../types'
import { json, badRequest, parseMonthParam, type AppEnv } from '../http'
import { rowToTransaction, UNCATEGORIZED_CONDITION } from '../db'

const MONTH_HELP = "Parâmetro 'month' inválido. Use o formato AAAA-MM (ex.: 2026-08)."

const MAX_TREND_MONTHS = 24
const DEFAULT_TREND_MONTHS = 6
const RECENT_TRANSACTIONS_LIMIT = 5
const ATTENTION_LIMIT = 3

/**
 * Folga do indicador de ritmo, em fracao do mes.
 *
 * Sem ela o status oscilaria de um dia para o outro sempre que o gasto ficasse
 * colado na linha do tempo do mes, e um aviso que pisca vira ruido.
 */
const PACE_TOLERANCE = 0.1

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

/**
 * Transferencia nao e gasto nem renda - o dinheiro continua sendo seu.
 *
 * Sem este filtro, pagar a fatura do cartao entra como despesa DE NOVO (as
 * compras ja foram lancadas uma a uma), aplicar no cofrinho vira "gasto" e
 * resgatar vira "renda". Numa conta comum isso infla o total do mes em
 * milhares de reais e o numero da tela inicial deixa de significar algo.
 *
 * O teto por categoria ja filtrava kind='expense'; o total, o detalhamento e a
 * tendencia nao filtravam - e as duas telas discordavam entre si.
 *
 * COALESCE: lancamento sem categoria conta como despesa, que e o padrao certo
 * para algo ainda nao classificado.
 */
const NOT_TRANSFER = "COALESCE(c.kind, 'expense') <> 'transfer'"

/**
 * COALESCE(teto do mes, teto '*'): o usuario configura o teto padrao uma vez e
 * so nasce linha por mes quando ha sobrescrita pontual.
 */
const BUDGET_PROGRESS_SQL = `
  WITH bud AS (
    SELECT c.id AS category_id, c.name, c.color_slot, c.icon,
           COALESCE(bm.limit_amount, bd.limit_amount) AS limit_amount
    FROM categories c
    LEFT JOIN budgets bm ON bm.category_id = c.id AND bm.month = ?1
    LEFT JOIN budgets bd ON bd.category_id = c.id AND bd.month = '*'
    WHERE c.is_archived = 0 AND c.kind = 'expense'
  ),
  spent AS (
    SELECT category_id, SUM(-amount) AS total, COUNT(*) AS tx_count
    FROM transactions
    WHERE date >= ?2 AND date <= ?3 AND amount < 0 AND is_ignored = 0
    GROUP BY category_id
  )
  SELECT bud.*, COALESCE(spent.total, 0) AS spent, COALESCE(spent.tx_count, 0) AS tx_count
  FROM bud LEFT JOIN spent ON spent.category_id = bud.category_id
`

/** Os tres numeros do topo da tela em uma varredura so do mes. */
const TOTALS_SQL = `
  SELECT
    COALESCE(SUM(CASE WHEN t.amount < 0 AND t.is_ignored = 0 THEN -t.amount ELSE 0 END), 0) AS total_spent,
    COALESCE(SUM(CASE WHEN t.amount > 0 AND t.is_ignored = 0 THEN t.amount ELSE 0 END), 0) AS total_income,
    COALESCE(SUM(CASE WHEN ${UNCATEGORIZED_CONDITION} THEN 1 ELSE 0 END), 0) AS uncategorized
  FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id
  WHERE t.date >= ?1 AND t.date <= ?2 AND ${NOT_TRANSFER}
`

const RECENT_SQL = `
  SELECT t.*, a.name AS account_name, c.name AS category_name, c.color_slot AS category_color_slot
  FROM transactions t
  LEFT JOIN accounts a ON a.id = t.account_id
  LEFT JOIN categories c ON c.id = t.category_id
  WHERE t.date >= ?1 AND t.date <= ?2
  ORDER BY t.date DESC, t.id DESC
  LIMIT ${RECENT_TRANSACTIONS_LIMIT}
`

const LAST_SYNC_SQL = `
  SELECT COALESCE(finished_at, started_at) AS last_sync_at, status
  FROM sync_log
  ORDER BY started_at DESC, id DESC
  LIMIT 1
`

const BREAKDOWN_SQL = `
  SELECT t.category_id AS category_id,
         COALESCE(c.name, 'Sem categoria') AS category_name,
         COALESCE(c.color_slot, 0) AS color_slot,
         SUM(-t.amount) AS spent,
         COUNT(*) AS tx_count
  FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id
  WHERE t.date >= ?1 AND t.date <= ?2 AND t.amount < 0 AND t.is_ignored = 0
    AND ${NOT_TRANSFER}
  GROUP BY t.category_id
  ORDER BY spent DESC
`

/**
 * O que NAO entra no total do mes, por categoria.
 *
 * Existe porque a exclusao de transferencias do total - correta - tambem tirou
 * essas linhas de todas as telas de analise. Pagamento de fatura, aplicacao e
 * lancamento marcado como ignorado sumiram da visao junto com o problema que
 * causavam, e nao havia mais como auditar para onde aquele dinheiro foi.
 *
 * O espelho de BREAKDOWN_SQL: mesma forma, condicao invertida.
 */
const OUT_OF_MONTH_SQL = `
  SELECT t.category_id AS category_id,
         COALESCE(c.name, 'Sem categoria') AS category_name,
         COALESCE(c.color_slot, 0) AS color_slot,
         SUM(-t.amount) AS spent,
         COUNT(*) AS tx_count
  FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id
  WHERE t.date >= ?1 AND t.date <= ?2 AND t.amount < 0
    AND (t.is_ignored = 1 OR COALESCE(c.kind, 'expense') = 'transfer')
  GROUP BY t.category_id
  ORDER BY spent DESC
`

/**
 * A serie inteira em uma consulta. Agrupar por substr(date,1,7) e seguro porque
 * a coluna date ja guarda a data convertida para BRT na ingestao.
 */
const TRENDS_SQL = `
  SELECT substr(t.date, 1, 7) AS month,
         t.category_id AS category_id,
         SUM(-t.amount) AS spent
  FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id
  WHERE t.date >= ?1 AND t.date <= ?2 AND t.amount < 0 AND t.is_ignored = 0
    AND ${NOT_TRANSFER}
  GROUP BY month, t.category_id
  ORDER BY month, spent DESC
`

// ---------------------------------------------------------------------------
// Linhas cruas do D1
// ---------------------------------------------------------------------------

interface BudgetProgressRow {
  category_id: number
  name: string
  color_slot: number
  icon: string | null
  limit_amount: number | null
  spent: number
  tx_count: number
}

interface TotalsRow {
  total_spent: number
  total_income: number
  uncategorized: number
}

interface LastSyncRow {
  last_sync_at: string | null
  status: string | null
}

interface BreakdownRow {
  category_id: number | null
  category_name: string
  color_slot: number
  spent: number
  tx_count: number
}

interface TrendRow {
  month: string
  category_id: number | null
  spent: number
}

// ---------------------------------------------------------------------------
// Orcamento
// ---------------------------------------------------------------------------

/** Fracoes (percentual, progresso) com 4 casas: evita ruido de float no JSON. */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}

function budgetPercent(limit: number | null, spent: number): number | null {
  if (limit === null) return null
  if (limit > 0) return round4(spent / limit)
  // Teto de zero e valido ("nao gastar nada nesta categoria"), mas dividir por
  // ele daria Infinity, que nao sobrevive ao JSON. Aqui 1 significa "no teto ou
  // acima" e a severidade real fica no estado.
  return spent > 0 ? 1 : 0
}

function budgetState(limit: number | null, spent: number, percent: number | null): BudgetState {
  if (limit === null || percent === null) return 'sem_orcamento'
  if (limit === 0) return spent > 0 ? 'estourado' : 'ok'
  if (percent > 1) return 'estourado'
  if (percent >= BUDGET_WARN_THRESHOLD) return 'atencao'
  return 'ok'
}

function toBudgetProgress(row: BudgetProgressRow): BudgetProgress {
  const limit = row.limit_amount === null ? null : round2(row.limit_amount)
  const spent = round2(row.spent ?? 0)
  const percent = budgetPercent(limit, spent)

  return {
    categoryId: row.category_id,
    categoryName: row.name,
    colorSlot: row.color_slot,
    icon: row.icon,
    limitAmount: limit,
    spent,
    remaining: limit === null ? null : round2(limit - spent),
    percent,
    state: budgetState(limit, spent, percent),
    txCount: row.tx_count ?? 0,
  }
}

/**
 * Maior consumo primeiro; categorias sem teto vao para o fim.
 * A tela existe para mostrar o que esta estourando, nao a lista alfabetica.
 */
function byConsumptionDesc(a: BudgetProgress, b: BudgetProgress): number {
  if (a.percent === null && b.percent === null) return b.spent - a.spent
  if (a.percent === null) return 1
  if (b.percent === null) return -1
  if (b.percent !== a.percent) return b.percent - a.percent
  return b.spent - a.spent
}

function budgetProgressStatement(db: D1Database, month: string): D1PreparedStatement {
  const { from, to } = monthBounds(month)
  return db.prepare(BUDGET_PROGRESS_SQL).bind(month, from, to)
}

function mapBudgetProgress(rows: BudgetProgressRow[]): BudgetProgress[] {
  return rows.map(toBudgetProgress).sort(byConsumptionDesc)
}

/** Progresso de orcamento do mes, ja ordenado por consumo. Reusado por /budgets. */
export async function computeBudgetProgress(
  db: D1Database,
  month: string,
): Promise<BudgetProgress[]> {
  const { results } = await budgetProgressStatement(db, month).all<BudgetProgressRow>()
  return mapBudgetProgress(results)
}

// ---------------------------------------------------------------------------
// Ritmo
// ---------------------------------------------------------------------------

function computePace(month: string, totalSpent: number, totalBudget: number): Pace {
  // monthProgress devolve elapsed = 1 para meses passados e 0 para futuros,
  // entao a projecao abaixo nunca extrapola um mes que nao e o corrente: em mes
  // fechado a "projecao" e o proprio gasto realizado.
  const { elapsed, daysLeft } = monthProgress(month)

  const budgetUsed = totalBudget > 0 ? totalSpent / totalBudget : 0
  const projectedSpend = elapsed > 0 ? totalSpent / elapsed : totalSpent
  const safeDailySpend = daysLeft > 0 ? Math.max(0, (totalBudget - totalSpent) / daysLeft) : 0

  let status: PaceStatus
  if (totalBudget <= 0) status = 'sem_orcamento'
  else if (budgetUsed > elapsed + PACE_TOLERANCE) status = 'acelerado'
  else if (budgetUsed < elapsed - PACE_TOLERANCE) status = 'tranquilo'
  else status = 'no_ritmo'

  return {
    status,
    monthElapsed: round4(elapsed),
    budgetUsed: round4(budgetUsed),
    projectedSpend: round2(projectedSpend),
    projectedOverspend: round2(projectedSpend - totalBudget),
    safeDailySpend: round2(safeDailySpend),
    daysLeft,
  }
}

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------

export const summaryRoutes = new Hono<AppEnv>()

summaryRoutes.get('/summary', async (c) => {
  const month = parseMonthParam(c)
  if (!month || !isValidMonth(month)) return badRequest(MONTH_HELP)

  const db = c.env.DB
  const { from, to } = monthBounds(month)

  // Uma unica ida ao D1. db.batch aplica um tipo so a todos os itens, por isso
  // cada resultado e tipado na linha em que e consumido.
  const batch = await db.batch<any>([
    budgetProgressStatement(db, month),
    db.prepare(TOTALS_SQL).bind(from, to),
    db.prepare(RECENT_SQL).bind(from, to),
    db.prepare(LAST_SYNC_SQL),
  ])

  const budgetRows: BudgetProgressRow[] = batch[0]?.results ?? []
  const totals: TotalsRow | undefined = batch[1]?.results?.[0]
  const recentRows: any[] = batch[2]?.results ?? []
  const lastSync: LastSyncRow | undefined = batch[3]?.results?.[0]

  const budgets = mapBudgetProgress(budgetRows)

  let totalBudget = 0
  for (const b of budgets) {
    if (b.limitAmount !== null) totalBudget += b.limitAmount
  }
  totalBudget = round2(totalBudget)

  const totalSpent = round2(totals?.total_spent ?? 0)
  const totalIncome = round2(totals?.total_income ?? 0)

  const recentTransactions: Transaction[] = recentRows.map((row) => rowToTransaction(row))

  const summary: MonthSummary = {
    month,
    totalSpent,
    totalIncome,
    totalBudget,
    remaining: round2(totalBudget - totalSpent),
    netFlow: round2(totalIncome - totalSpent),
    pace: computePace(month, totalSpent, totalBudget),
    budgets,
    // budgets ja vem ordenado por consumo, entao os piores sao os primeiros.
    attention: budgets
      .filter((b) => b.state === 'atencao' || b.state === 'estourado')
      .slice(0, ATTENTION_LIMIT),
    recentTransactions,
    uncategorizedCount: Number(totals?.uncategorized ?? 0),
    lastSyncAt: lastSync?.last_sync_at ?? null,
    lastSyncStatus: lastSync?.status ?? null,
  }

  return json(summary)
})

summaryRoutes.get('/breakdown', async (c) => {
  const month = parseMonthParam(c)
  if (!month || !isValidMonth(month)) return badRequest(MONTH_HELP)

  // ?scope=out devolve o espelho: o que ficou de FORA do total do mes.
  const outOfMonth = c.req.query('scope') === 'out'

  const { from, to } = monthBounds(month)
  const { results } = await c.env.DB.prepare(outOfMonth ? OUT_OF_MONTH_SQL : BREAKDOWN_SQL)
    .bind(from, to)
    .all<BreakdownRow>()

  let total = 0
  for (const row of results) total += row.spent
  total = round2(total)

  const breakdown: CategoryBreakdown[] = results.map((row) => {
    const spent = round2(row.spent)
    return {
      categoryId: row.category_id,
      categoryName: row.category_name,
      colorSlot: row.color_slot,
      spent,
      share: total > 0 ? round4(spent / total) : 0,
      txCount: row.tx_count,
    }
  })

  return json(breakdown)
})

summaryRoutes.get('/trends', async (c) => {
  const rawMonths = c.req.query('months')
  let months = DEFAULT_TREND_MONTHS
  if (rawMonths !== undefined && rawMonths !== '') {
    const parsed = Number(rawMonths)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_TREND_MONTHS) {
      return badRequest(
        `Parâmetro 'months' inválido. Informe um número inteiro entre 1 e ${MAX_TREND_MONTHS}.`,
      )
    }
    months = parsed
  }

  const end = currentMonth()
  const start = addMonths(end, -(months - 1))
  const from = monthBounds(start).from
  const to = monthBounds(end).to

  const { results } = await c.env.DB.prepare(TRENDS_SQL).bind(from, to).all<TrendRow>()

  // A serie precisa ser continua para o grafico: meses sem movimento entram
  // zerados em vez de sumirem do eixo.
  const byMonth = new Map<string, MonthTrend>()
  let cursor = start
  for (let i = 0; i < months; i++) {
    byMonth.set(cursor, { month: cursor, totalSpent: 0, byCategory: [] })
    cursor = addMonths(cursor, 1)
  }

  for (const row of results) {
    const entry = byMonth.get(row.month)
    if (!entry) continue
    const spent = round2(row.spent)
    entry.totalSpent = round2(entry.totalSpent + spent)
    // Gasto sem categoria conta no total do mes, mas nao vira fatia do grafico.
    if (row.category_id !== null) {
      entry.byCategory.push({ categoryId: row.category_id, spent })
    }
  }

  const trends: MonthTrend[] = [...byMonth.values()]
  return json(trends)
})
