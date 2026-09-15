/**
 * Motor de categorizacao.
 *
 * Precedencia ESTRITA:
 *
 *     manual  >  regra de texto  >  categoria do Pluggy  >  Outros
 *
 * O topo dessa lista nao aparece aqui de proposito: a protecao do override
 * manual vive no SQL do upsert (worker/db.ts), para valer mesmo quando um
 * chamador esquece de checar. Este modulo cuida das tres camadas abaixo.
 *
 * Por que as regras pesam tanto: o campo `category` da API do Pluggy exige plano
 * Pro. No plano gratuito ele costuma vir nulo, entao o mapa pluggy_category_map
 * quase nunca decide - quem categoriza de fato e a regra de texto.
 */

import type { CategorySource, MatchType, Rule } from '@shared/types'
import { rowToRule, type Row } from './db'
import { normalizeText } from './import/normalize'

export interface CategorizationContext {
  rules: Rule[]
  /** categoria do Pluggy (minuscula) -> id da categoria do usuario */
  pluggyMap: Map<string, number>
  /** id de "Outros", usado quando nada casa. */
  fallbackCategoryId: number | null
  /** Categorias com kind='transfer': entram como ignoradas no orcamento. */
  transferCategoryIds: Set<number>
}

export interface CategorizationInput {
  description: string
  merchantName?: string | null
  amount: number
  pluggyCategory?: string | null
}

export interface CategorizationOutcome {
  categoryId: number | null
  source: CategorySource
  /** true quando a categoria escolhida e do tipo transferencia. */
  isTransfer: boolean
}

/**
 * Carrega tudo de que a categorizacao precisa em TRES queries.
 *
 * Chame uma vez antes do laco. Consultar por transacao transformaria um sync de
 * 300 lancamentos em 900 idas ao banco e estouraria o limite de CPU.
 */
export async function loadCategorizationContext(
  db: D1Database,
): Promise<CategorizationContext> {
  // O batch devolve os resultados na ordem dos statements; a desestruturacao com
  // fallback existe so para satisfazer noUncheckedIndexedAccess.
  const batch = await db.batch<Row>([
    db.prepare(`
      SELECT r.*, c.name AS category_name
      FROM rules r
      JOIN categories c ON c.id = r.category_id
      ORDER BY r.priority ASC, r.id ASC
    `),
    db.prepare('SELECT pluggy_category, category_id FROM pluggy_category_map'),
    db.prepare('SELECT id, name, kind FROM categories WHERE is_archived = 0'),
  ])

  const rulesRes = batch[0]
  const mapRes = batch[1]
  const catsRes = batch[2]

  const pluggyMap = new Map<string, number>()
  for (const row of mapRes?.results ?? []) {
    const key = String(row.pluggy_category ?? '').toLowerCase()
    const id = Number(row.category_id)
    if (key && Number.isFinite(id)) pluggyMap.set(key, id)
  }

  let fallbackCategoryId: number | null = null
  const transferCategoryIds = new Set<number>()
  for (const row of catsRes?.results ?? []) {
    const id = Number(row.id)
    if (!Number.isFinite(id)) continue
    if (String(row.name) === 'Outros') fallbackCategoryId = id
    if (String(row.kind) === 'transfer') transferCategoryIds.add(id)
  }

  return {
    rules: (rulesRes?.results ?? []).map(rowToRule),
    pluggyMap,
    fallbackCategoryId,
    transferCategoryIds,
  }
}

/** Testa um padrao ja normalizado contra um texto ja normalizado. */
function matches(text: string, pattern: string, matchType: MatchType): boolean {
  if (!pattern) return false
  switch (matchType) {
    case 'startsWith':
      return text.startsWith(pattern)
    case 'exact':
      return text === pattern
    default:
      return text.includes(pattern)
  }
}

/**
 * Decide a categoria de uma transacao. Funcao pura: nao toca no banco, o que a
 * torna barata o suficiente para rodar dentro do laco do sync.
 *
 * As regras chegam ordenadas por prioridade, entao a PRIMEIRA que casa vence.
 * E isso que faz 'uber eats' (prioridade 5) ganhar de 'uber' (20) e a compra no
 * iFood nao virar Transporte.
 */
export function categorizeTransaction(
  ctx: CategorizationContext,
  input: CategorizationInput,
): CategorizationOutcome {
  const text = normalizeText(`${input.description} ${input.merchantName ?? ''}`)

  for (const rule of ctx.rules) {
    if (rule.minAmount !== null && Math.abs(input.amount) < rule.minAmount) continue
    if (rule.maxAmount !== null && Math.abs(input.amount) > rule.maxAmount) continue
    if (!matches(text, rule.pattern, rule.matchType)) continue
    return {
      categoryId: rule.categoryId,
      source: 'rule',
      isTransfer: ctx.transferCategoryIds.has(rule.categoryId),
    }
  }

  const pluggyKey = input.pluggyCategory?.toLowerCase().trim()
  if (pluggyKey) {
    const mapped = ctx.pluggyMap.get(pluggyKey)
    if (mapped !== undefined) {
      return {
        categoryId: mapped,
        source: 'pluggy',
        isTransfer: ctx.transferCategoryIds.has(mapped),
      }
    }
  }

  return { categoryId: ctx.fallbackCategoryId, source: 'none', isTransfer: false }
}

/**
 * Reaplica uma regra no historico.
 *
 * Roda em UM UPDATE, e nao linha a linha, por dois motivos: o limite de 10ms de
 * CPU, e porque o filtro de acento precisa acontecer no banco - por isso a
 * comparacao usa `search_text`, que ja foi normalizado na ingestao.
 *
 * O WHERE exclui category_source = 'manual': uma escolha do usuario nunca e
 * desfeita por uma regra criada depois.
 */
export async function applyRuleBackfill(db: D1Database, rule: Rule): Promise<number> {
  const pattern = normalizeText(rule.pattern)
  if (!pattern) return 0

  // Sem escapar, um padrao com '%' ou '_' viraria curinga: a regra 'net_flix'
  // casaria com qualquer caractere no lugar do sublinhado.
  const escaped = pattern.replace(/[\\%_]/g, (char) => `\\${char}`)
  const like =
    rule.matchType === 'startsWith'
      ? `${escaped}%`
      : rule.matchType === 'exact'
        ? escaped
        : `%${escaped}%`

  const conditions = ["category_source <> 'manual'", 'search_text LIKE ?2 ESCAPE \'\\\'']
  const binds: (string | number)[] = [rule.categoryId, like]

  if (rule.minAmount !== null) {
    conditions.push(`ABS(amount) >= ?${binds.length + 1}`)
    binds.push(rule.minAmount)
  }
  if (rule.maxAmount !== null) {
    conditions.push(`ABS(amount) <= ?${binds.length + 1}`)
    binds.push(rule.maxAmount)
  }

  const result = await db
    .prepare(`
      UPDATE transactions
      SET category_id = ?1, category_source = 'rule', updated_at = datetime('now')
      WHERE ${conditions.join(' AND ')}
        AND (category_id IS NULL OR category_id <> ?1)
    `)
    .bind(...binds)
    .run()

  const changed = result.meta?.changes ?? 0
  if (changed > 0) {
    await db
      .prepare('UPDATE rules SET hit_count = hit_count + ?1 WHERE id = ?2')
      .bind(changed, rule.id)
      .run()
  }
  return changed
}

export interface CreateRuleOptions {
  pattern: string
  categoryId: number
  matchType?: MatchType
  priority?: number
  minAmount?: number | null
  maxAmount?: number | null
}

/**
 * Cria (ou substitui) uma regra.
 *
 * ON CONFLICT no `pattern` porque a coluna e UNIQUE: recategorizar o mesmo
 * estabelecimento duas vezes deve corrigir a regra existente, nao acumular
 * regras contraditorias que passariam a depender da ordem de insercao.
 */
export async function createRuleFromTransaction(
  db: D1Database,
  opts: CreateRuleOptions,
): Promise<Rule> {
  const pattern = normalizeText(opts.pattern)
  if (!pattern) throw new Error('Padrao de regra vazio.')

  const row = await db
    .prepare(`
      INSERT INTO rules (pattern, match_type, category_id, priority, min_amount, max_amount)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)
      ON CONFLICT(pattern) DO UPDATE SET
        category_id = excluded.category_id,
        match_type  = excluded.match_type,
        priority    = excluded.priority,
        min_amount  = excluded.min_amount,
        max_amount  = excluded.max_amount
      RETURNING *, (SELECT name FROM categories WHERE id = rules.category_id) AS category_name
    `)
    .bind(
      pattern,
      opts.matchType ?? 'contains',
      opts.categoryId,
      // Regra criada pelo usuario nasce com prioridade alta (numero baixo) para
      // ganhar das regras genericas do seed.
      opts.priority ?? 15,
      opts.minAmount ?? null,
      opts.maxAmount ?? null,
    )
    .first<Row>()

  if (!row) throw new Error('Falha ao criar a regra.')
  return rowToRule(row)
}
