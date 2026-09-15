/**
 * Categorias.
 *
 * color_slot guarda o SLOT da paleta, nunca o hex: o slot existe nas versoes
 * clara e escura e nao deixa entrar cor de fora da paleta validada. Por isso o
 * limite aceito aqui vem de CATEGORICAL, e nao de um 8 solto no codigo.
 *
 * Categorias is_system ('Outros', 'Transferencias', 'Renda') sustentam regras do
 * app - nao podem ser apagadas nem trocar de kind.
 */

import { Hono } from 'hono'

import type { Category, CategoryKind, CreateCategoryRequest } from '@shared/types'
import { CATEGORICAL } from '@shared/palette'

import { json, badRequest, apiError, type AppEnv } from '../http'
import { rowToCategory, type Row } from '../db'

const CATEGORY_KINDS: readonly CategoryKind[] = ['expense', 'income', 'transfer']

/** Slot 0 = neutro; 1..N = paleta categorica validada. */
const MAX_COLOR_SLOT = CATEGORICAL.light.length

const MAX_NAME_LENGTH = 40
const MAX_ICON_LENGTH = 40
const MAX_SORT_ORDER = 9999

const KIND_HELP = "Campo 'kind' inválido. Use 'expense', 'income' ou 'transfer'."
const COLOR_HELP = `Campo 'colorSlot' inválido. Use um número inteiro entre 0 e ${MAX_COLOR_SLOT}.`

const SELECT_ALL_SQL = 'SELECT * FROM categories ORDER BY sort_order, name'

/**
 * A categoria nova entra depois das existentes do usuario. As do sistema ficam
 * em sort_order 900+, entao continuam no fim da lista.
 */
const INSERT_SQL = `
  INSERT INTO categories (name, kind, color_slot, icon, sort_order)
  VALUES (?1, ?2, ?3, ?4,
          (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM categories WHERE is_system = 0))
  RETURNING *
`

interface ExistingCategory {
  id: number
  kind: string
  is_system: number
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

function isCategoryKind(value: unknown): value is CategoryKind {
  return typeof value === 'string' && (CATEGORY_KINDS as readonly string[]).includes(value)
}

function isValidColorSlot(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_COLOR_SLOT
}

/** O UNIQUE do schema e a rede de seguranca; esta checagem so gera erro legivel. */
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint/i.test(err.message)
}

function duplicateName(name: string) {
  return apiError(`Já existe uma categoria chamada "${name}".`, 400, { code: 'duplicate_name' })
}

async function nameTaken(db: D1Database, name: string, exceptId: number | null): Promise<boolean> {
  const row = await db
    .prepare('SELECT id FROM categories WHERE lower(name) = lower(?1) AND id <> ?2')
    .bind(name, exceptId ?? 0)
    .first<{ id: number }>()
  return row !== null
}

export const categoryRoutes = new Hono<AppEnv>()

categoryRoutes.get('/categories', async (c) => {
  const { results } = await c.env.DB.prepare(SELECT_ALL_SQL).all<any>()
  const categories: Category[] = results.map((row) => rowToCategory(row))
  return json(categories)
})

categoryRoutes.post('/categories', async (c) => {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    return badRequest('Corpo da requisição inválido: envie um JSON.')
  }

  const body = asObject(raw)
  if (!body) return badRequest('Corpo da requisição inválido: envie um objeto JSON.')

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return badRequest('Informe um nome para a categoria.')
  if (name.length > MAX_NAME_LENGTH) {
    return badRequest(`O nome da categoria deve ter no máximo ${MAX_NAME_LENGTH} caracteres.`)
  }

  if (!isCategoryKind(body.kind)) return badRequest(KIND_HELP)
  if (!isValidColorSlot(body.colorSlot)) return badRequest(COLOR_HELP)

  let icon: string | null = null
  if (body.icon !== undefined && body.icon !== null) {
    if (typeof body.icon !== 'string' || body.icon.trim().length > MAX_ICON_LENGTH) {
      return badRequest(`Campo 'icon' inválido: texto de até ${MAX_ICON_LENGTH} caracteres.`)
    }
    icon = body.icon.trim() || null
  }

  if (await nameTaken(c.env.DB, name, null)) return duplicateName(name)

  const payload: CreateCategoryRequest = { name, kind: body.kind, colorSlot: body.colorSlot, icon }

  let row: Row | null = null
  try {
    row = await c.env.DB.prepare(INSERT_SQL)
      .bind(payload.name, payload.kind, payload.colorSlot, payload.icon ?? null)
      .first<Row>()
  } catch (err) {
    if (isUniqueViolation(err)) return duplicateName(name)
    throw err
  }

  if (!row) return apiError('Não foi possível criar a categoria.', 500)
  return json(rowToCategory(row), 201)
})

categoryRoutes.patch('/categories/:id', async (c) => {
  const id = parseCategoryId(c.req.param('id'))
  if (id === null) return badRequest('Identificador de categoria inválido.')

  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    return badRequest('Corpo da requisição inválido: envie um JSON.')
  }

  const body = asObject(raw)
  if (!body) return badRequest('Corpo da requisição inválido: envie um objeto JSON.')

  const existing = await c.env.DB.prepare('SELECT id, kind, is_system FROM categories WHERE id = ?1')
    .bind(id)
    .first<ExistingCategory>()
  if (!existing) return apiError('Categoria não encontrada.', 404, { code: 'not_found' })

  // Lista fixa de colunas: nada vindo do corpo entra na SQL como identificador.
  const sets: string[] = []
  const values: unknown[] = []

  if ('name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return badRequest('O nome da categoria não pode ficar vazio.')
    if (name.length > MAX_NAME_LENGTH) {
      return badRequest(`O nome da categoria deve ter no máximo ${MAX_NAME_LENGTH} caracteres.`)
    }
    if (await nameTaken(c.env.DB, name, id)) return duplicateName(name)
    sets.push('name = ?')
    values.push(name)
  }

  if ('kind' in body) {
    if (!isCategoryKind(body.kind)) return badRequest(KIND_HELP)
    if (existing.is_system === 1 && body.kind !== existing.kind) {
      return badRequest('Esta categoria é do sistema e não pode mudar de tipo.')
    }
    sets.push('kind = ?')
    values.push(body.kind)
  }

  if ('colorSlot' in body) {
    if (!isValidColorSlot(body.colorSlot)) return badRequest(COLOR_HELP)
    sets.push('color_slot = ?')
    values.push(body.colorSlot)
  }

  if ('icon' in body) {
    if (body.icon === null) {
      sets.push('icon = ?')
      values.push(null)
    } else if (typeof body.icon === 'string' && body.icon.trim().length <= MAX_ICON_LENGTH) {
      sets.push('icon = ?')
      values.push(body.icon.trim() || null)
    } else {
      return badRequest(`Campo 'icon' inválido: texto de até ${MAX_ICON_LENGTH} caracteres.`)
    }
  }

  if ('sortOrder' in body) {
    const sortOrder = body.sortOrder
    if (
      typeof sortOrder !== 'number' ||
      !Number.isInteger(sortOrder) ||
      sortOrder < 0 ||
      sortOrder > MAX_SORT_ORDER
    ) {
      return badRequest(
        `Campo 'sortOrder' inválido. Use um número inteiro entre 0 e ${MAX_SORT_ORDER}.`,
      )
    }
    sets.push('sort_order = ?')
    values.push(sortOrder)
  }

  if ('isArchived' in body) {
    if (typeof body.isArchived !== 'boolean') {
      return badRequest("Campo 'isArchived' inválido: use true ou false.")
    }
    sets.push('is_archived = ?')
    values.push(body.isArchived ? 1 : 0)
  }

  if (sets.length === 0) return badRequest('Nenhum campo para atualizar foi enviado.')

  let row: Row | null = null
  try {
    row = await c.env.DB.prepare(`UPDATE categories SET ${sets.join(', ')} WHERE id = ? RETURNING *`)
      .bind(...values, id)
      .first<Row>()
  } catch (err) {
    if (isUniqueViolation(err)) {
      return badRequest('Já existe outra categoria com esse nome.')
    }
    throw err
  }

  if (!row) return apiError('Categoria não encontrada.', 404, { code: 'not_found' })

  const category: Category = rowToCategory(row)
  return json(category)
})

categoryRoutes.delete('/categories/:id', async (c) => {
  const id = parseCategoryId(c.req.param('id'))
  if (id === null) return badRequest('Identificador de categoria inválido.')

  const existing = await c.env.DB.prepare('SELECT id, is_system FROM categories WHERE id = ?1')
    .bind(id)
    .first<{ id: number; is_system: number }>()
  if (!existing) return apiError('Categoria não encontrada.', 404, { code: 'not_found' })

  if (existing.is_system === 1) {
    return badRequest('Esta categoria é do sistema e não pode ser excluída.')
  }

  // As transacoes nao somem junto: o schema declara ON DELETE SET NULL, entao
  // elas voltam para "sem categoria" e reaparecem na fila de categorizacao.
  await c.env.DB.prepare('DELETE FROM categories WHERE id = ?1').bind(id).run()

  return json({ ok: true })
})
