/**
 * Rotas de regras de categorizacao.
 *
 * O padrao e SEMPRE gravado normalizado (minusculo, sem acento), porque e assim
 * que o motor compara. Gravar "Padaria Açúcar" cru criaria uma regra que nunca
 * casa com nada - o pior tipo de bug, porque parece que funcionou.
 */

import { Hono } from 'hono'
import type { CreateRuleRequest, MatchType, Rule } from '@shared/types'
import { apiError, badRequest, json, type AppEnv } from '../http'
import { rowToRule } from '../db'
import { applyRuleBackfill } from '../categorize'
import { normalizeText } from '../import/normalize'

/** Linha crua do D1; a traducao para o dominio vive em rowToRule (../db). */
type DbRow = any

const MATCH_TYPES: MatchType[] = ['contains', 'startsWith', 'exact']
const MIN_PATTERN_LENGTH = 2
const MAX_PATTERN_LENGTH = 120
const DEFAULT_PRIORITY = 100
const MAX_PRIORITY = 999

const RULE_SELECT = `
  SELECT r.*, c.name AS category_name
    FROM rules r
    LEFT JOIN categories c ON c.id = r.category_id
`

export const ruleRoutes = new Hono<AppEnv>()

// ---------------------------------------------------------------------------
// GET /rules
// ---------------------------------------------------------------------------

ruleRoutes.get('/rules', async (c) => {
  const { results } = await c.env.DB
    .prepare(`${RULE_SELECT} ORDER BY r.priority ASC, r.id ASC`)
    .all<DbRow>()
  const rules: Rule[] = (results ?? []).map(rowToRule)
  return json(rules)
})

// ---------------------------------------------------------------------------
// POST /rules
// ---------------------------------------------------------------------------

ruleRoutes.post('/rules', async (c) => {
  const db = c.env.DB

  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    return badRequest('Corpo inválido: esperado JSON.')
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return badRequest('Corpo inválido: esperado um objeto JSON.')
  }
  const body = raw as Partial<CreateRuleRequest>

  if (typeof body.pattern !== 'string') return badRequest('Informe o texto da regra.')
  const pattern = normalizeText(body.pattern).trim()
  if (pattern.length < MIN_PATTERN_LENGTH) {
    return badRequest(`Texto da regra muito curto (mínimo ${MIN_PATTERN_LENGTH} caracteres).`)
  }
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return badRequest(`Texto da regra muito longo (máximo ${MAX_PATTERN_LENGTH} caracteres).`)
  }

  const matchType: MatchType = body.matchType ?? 'contains'
  if (!MATCH_TYPES.includes(matchType)) {
    return badRequest("Tipo de comparação inválido. Use 'contains', 'startsWith' ou 'exact'.")
  }

  const categoryId = body.categoryId
  if (typeof categoryId !== 'number' || !Number.isInteger(categoryId) || categoryId <= 0) {
    return badRequest('Categoria inválida.')
  }
  const category = await db
    .prepare('SELECT id FROM categories WHERE id = ?')
    .bind(categoryId)
    .first<{ id: number }>()
  if (!category) return apiError('Categoria não encontrada.', 404)

  let priority = DEFAULT_PRIORITY
  if (body.priority !== undefined) {
    if (!Number.isInteger(body.priority)) return badRequest('Prioridade inválida.')
    priority = Math.min(MAX_PRIORITY, Math.max(0, body.priority))
  }

  // Regra identica ja existente e devolvida como esta: tocar "criar regra" duas
  // vezes na mesma tela nao pode encher a tabela de duplicatas.
  const duplicate = await db
    .prepare('SELECT id FROM rules WHERE pattern = ? AND match_type = ? AND category_id = ?')
    .bind(pattern, matchType, categoryId)
    .first<{ id: number }>()
  if (duplicate) {
    const existing = await fetchRule(db, duplicate.id)
    if (existing) return json(existing)
  }

  const inserted = await db
    .prepare('INSERT INTO rules (pattern, match_type, category_id, priority) VALUES (?, ?, ?, ?)')
    .bind(pattern, matchType, categoryId, priority)
    .run()

  const id = Number(inserted.meta?.last_row_id ?? 0)
  const rule = id > 0 ? await fetchRule(db, id) : null
  if (!rule) return apiError('Não consegui reler a regra recém-criada.', 500)

  // Reaplica no historico: a regra so tem valor se arrumar o que ja passou.
  // Transacoes com category_source='manual' continuam intocadas.
  await applyRuleBackfill(db, rule)

  return json(rule)
})

// ---------------------------------------------------------------------------
// DELETE /rules/:id
// ---------------------------------------------------------------------------

ruleRoutes.delete('/rules/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return badRequest('Identificador de regra inválido.')

  // As transacoes ja categorizadas por esta regra permanecem como estao: apagar
  // a regra e dizer "nao aplique mais", nao "esqueca o que eu ja classifiquei".
  const result = await c.env.DB.prepare('DELETE FROM rules WHERE id = ?').bind(id).run()
  if ((result.meta?.changes ?? 0) === 0) return apiError('Regra não encontrada.', 404)

  return json({ ok: true })
})

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

async function fetchRule(db: D1Database, id: number): Promise<Rule | null> {
  const row = await db.prepare(`${RULE_SELECT} WHERE r.id = ?`).bind(id).first<DbRow>()
  return row ? rowToRule(row) : null
}
