/**
 * Importacao de extrato (OFX/CSV) e exportacao em CSV.
 *
 * O fluxo tem duas etapas de proposito: preview e depois commit. Gravar direto
 * seria mais simples, mas importar extrato e uma operacao que o usuario faz com
 * medo de duplicar - ver "N novos, M duplicados" antes de confirmar e o que
 * torna a operacao segura de repetir.
 *
 * As linhas ficam no KV entre as duas etapas para o arquivo nao precisar subir
 * de novo no commit.
 */

import { Hono } from 'hono'
import type {
  ImportPreview,
  ImportPreviewRow,
  ImportResult,
  ParsedTransaction,
} from '@shared/types'
import { formatAmount } from '@shared/money'
import { monthBounds } from '@shared/dates'
import { apiError, badRequest, json, parseMonthParam, readJson, type AppEnv } from '../http'
import {
  IMPORTED_ACCOUNT_ID,
  buildDedupeKey,
  ensureImportedAccount,
  ensureLocalAccount,
  upsertTransactions,
  type Row,
  type TransactionInput,
} from '../db'
import { categorizeTransaction, loadCategorizationContext } from '../categorize'
import { looksLikeOfx, parseOfx } from '../import/ofx'
import { parseCsv } from '../import/csv'

export const importRoutes = new Hono<AppEnv>()

/** Limite do valor no KV e 25MB, mas payload grande tambem estoura a CPU. */
const MAX_CONTENT_BYTES = 1_000_000
const PREVIEW_TTL_SECONDS = 15 * 60

interface StoredPreview {
  accountId: string
  rows: (ParsedTransaction & { categoryId: number | null })[]
}

interface ImportRequestBody {
  filename?: string
  content?: string
  accountId?: string
}

/**
 * Id determinista para linha sem id de origem (CSV).
 *
 * Precisa ser estavel: reimportar o mesmo arquivo tem que gerar o mesmo id,
 * senao o ON CONFLICT nao dispara e a linha entra duplicada. FNV-1a serve bem
 * aqui - nao e criptografico, so precisa espalhar.
 */
function stableId(accountId: string, tx: ParsedTransaction): string {
  const seed = `${accountId}|${tx.date}|${tx.amount.toFixed(2)}|${tx.description.toLowerCase()}`
  let hash = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `csv_${hash.toString(16)}_${tx.date.replace(/-/g, '')}`
}

importRoutes.post('/import/preview', async (c) => {
  const body = await readJson<ImportRequestBody>(c)
  const content = typeof body?.content === 'string' ? body.content : ''
  if (!content.trim()) badRequest('Arquivo vazio.')
  if (content.length > MAX_CONTENT_BYTES) {
    badRequest('Arquivo muito grande. Exporte um período menor (até cerca de 1 MB).')
  }

  const filename = (body?.filename ?? '').toLowerCase()
  const isOfx = filename.endsWith('.ofx') || filename.endsWith('.qfx') || looksLikeOfx(content)

  let parsed: ParsedTransaction[]
  let source: 'ofx' | 'csv'
  try {
    if (isOfx) {
      parsed = parseOfx(content)
      source = 'ofx'
    } else {
      parsed = parseCsv(content).rows
      source = 'csv'
    }
  } catch {
    return apiError('Não consegui ler esse arquivo. Tente exportar em OFX pelo app do banco.', 400)
  }

  if (parsed.length === 0) {
    return apiError(
      'Nenhum lançamento encontrado no arquivo. Confira se o extrato tem colunas de data e valor.',
      400,
    )
  }

  const db = c.env.DB
  const accountId = body?.accountId
    ? await ensureLocalAccount(db, body.accountId, 'Conta importada')
    : await ensureImportedAccount(db)

  const ctx = await loadCategorizationContext(db)

  // Uma consulta so para descobrir tudo que ja existe. Checar linha a linha
  // multiplicaria as idas ao banco pelo tamanho do arquivo.
  const ids = parsed.map((tx) => tx.externalId ?? stableId(accountId, tx))
  const dedupeKeys = parsed.map((tx) => buildDedupeKey(tx.date, tx.amount, accountId))

  const existingIds = new Set<string>()
  const existingKeys = new Set<string>()
  for (let i = 0; i < ids.length; i += 80) {
    const idChunk = ids.slice(i, i + 80)
    const keyChunk = dedupeKeys.slice(i, i + 80)
    const res = await db
      .prepare(
        `SELECT id, dedupe_key FROM transactions
         WHERE id IN (${idChunk.map(() => '?').join(',')})
            OR dedupe_key IN (${keyChunk.map(() => '?').join(',')})`,
      )
      .bind(...idChunk, ...keyChunk)
      .all<Row>()
    for (const row of res.results ?? []) {
      existingIds.add(String(row.id))
      if (row.dedupe_key) existingKeys.add(String(row.dedupe_key))
    }
  }

  const categoryNames = new Map<number, string>()
  const catRows = await db.prepare('SELECT id, name FROM categories').all<Row>()
  for (const row of catRows.results ?? []) categoryNames.set(Number(row.id), String(row.name))

  const rows: ImportPreviewRow[] = []
  const stored: StoredPreview['rows'] = []
  let duplicateCount = 0

  for (let i = 0; i < parsed.length; i++) {
    const tx = parsed[i] as ParsedTransaction
    const id = ids[i] as string
    const key = dedupeKeys[i] as string

    const byId = existingIds.has(id)
    const byKey = !byId && existingKeys.has(key)
    const duplicate = byId || byKey
    if (duplicate) duplicateCount++

    const guess = categorizeTransaction(ctx, { description: tx.description, amount: tx.amount })

    rows.push({
      ...tx,
      externalId: id,
      suggestedCategoryId: guess.categoryId,
      suggestedCategoryName: guess.categoryId ? (categoryNames.get(guess.categoryId) ?? null) : null,
      duplicate,
      duplicateReason: byId ? 'id' : byKey ? 'dedupe_key' : null,
    })

    if (!duplicate) stored.push({ ...tx, externalId: id, categoryId: guess.categoryId })
  }

  const dates = parsed.map((tx) => tx.date).sort()
  const token = crypto.randomUUID()

  await c.env.CACHE.put(
    `import:${token}`,
    JSON.stringify({ accountId, rows: stored, source } satisfies StoredPreview & {
      source: string
    }),
    { expirationTtl: PREVIEW_TTL_SECONDS },
  )

  const preview: ImportPreview = {
    token,
    accountId,
    accountName: accountId === IMPORTED_ACCOUNT_ID ? 'Extrato importado' : accountId,
    rows,
    newCount: stored.length,
    duplicateCount,
    dateRange: dates.length ? { from: dates[0] as string, to: dates[dates.length - 1] as string } : null,
  }
  return json(preview)
})

importRoutes.post('/import/commit', async (c) => {
  const body = await readJson<{ token?: string }>(c)
  const token = typeof body?.token === 'string' ? body.token : ''
  if (!token) badRequest('Token de importação ausente.')

  const cached = await c.env.CACHE.get<StoredPreview & { source?: 'ofx' | 'csv' }>(
    `import:${token}`,
    'json',
  )
  if (!cached) {
    return apiError('A prévia expirou. Envie o arquivo novamente.', 410, { code: 'preview_expired' })
  }

  const inputs: TransactionInput[] = cached.rows.map((tx) => ({
    id: tx.externalId as string,
    accountId: cached.accountId,
    date: tx.date,
    amount: tx.amount,
    amountRaw: tx.amount,
    description: tx.description,
    categoryId: tx.categoryId,
    categorySource: tx.categoryId ? 'rule' : 'none',
    isManual: false,
    source: cached.source ?? 'csv',
  }))

  const outcome = await upsertTransactions(c.env.DB, inputs)
  await c.env.CACHE.delete(`import:${token}`)

  const result: ImportResult = {
    inserted: outcome.inserted,
    skipped: inputs.length - outcome.inserted,
  }
  return json(result)
})

/**
 * Exportacao em CSV.
 *
 * Separador ';' e valor no formato brasileiro para o Excel em pt-BR abrir sem
 * pedir assistente de importacao.
 */
importRoutes.get('/export', async (c) => {
  const month = parseMonthParam(c)
  const { from, to } = monthBounds(month)

  const res = await c.env.DB.prepare(
    `SELECT t.date, t.description, t.amount, a.name AS account_name,
            COALESCE(c.name, 'Sem categoria') AS category_name
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     LEFT JOIN accounts   a ON a.id = t.account_id
     WHERE t.date >= ? AND t.date <= ?
     ORDER BY t.date, t.id`,
  )
    .bind(from, to)
    .all<Row>()

  const escape = (value: unknown): string => {
    const text = String(value ?? '')
    return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }

  const lines = ['Data;Descrição;Categoria;Valor;Conta']
  for (const row of res.results ?? []) {
    const [y, m, d] = String(row.date).split('-')
    lines.push(
      [
        `${d}/${m}/${y}`,
        escape(row.description),
        escape(row.category_name),
        formatAmount(Number(row.amount)),
        escape(row.account_name),
      ].join(';'),
    )
  }

  // BOM para o Excel reconhecer UTF-8 e nao quebrar os acentos.
  return new Response(`﻿${lines.join('\r\n')}\r\n`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="mabills-${month}.csv"`,
    },
  })
})
