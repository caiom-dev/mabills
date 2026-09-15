/**
 * Parser de CSV de extrato bancario.
 *
 * Tres coisas que um split(',') ingenuo erra e aqui sao tratadas:
 *  - bancos brasileiros costumam exportar com ';' porque a virgula e decimal;
 *  - descricao entre aspas pode conter o proprio separador;
 *  - extratos trazem cabecalho e rodape que nao sao lancamentos.
 *
 * Diferente do OFX, o CSV nao tem id estavel. A deduplicacao na importacao cai
 * para dedupe_key (data + valor + conta).
 */

import type { ParsedTransaction } from '@shared/types'
import { parseAmount } from '@shared/money'
import { isValidDate } from '@shared/dates'

export interface CsvMapping {
  date?: string
  description?: string
  amount?: string
  /** Alguns extratos separam entrada e saida em duas colunas. */
  debit?: string
  credit?: string
}

export interface CsvParseResult {
  rows: ParsedTransaction[]
  headers: string[]
  mapping: CsvMapping
  /** Linhas descartadas por nao parecerem lancamento (cabecalho, rodape, saldo). */
  skipped: number
}

/** Divide respeitando aspas duplas, com "" como aspas escapadas. */
function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (char === delimiter && !inQuotes) {
      out.push(current)
      current = ''
      continue
    }
    current += char
  }
  out.push(current)
  return out.map((value) => value.trim().replace(/^"|"$/g, '').trim())
}

/** O separador e o candidato que aparece com mais consistencia nas primeiras linhas. */
function detectDelimiter(lines: string[]): string {
  const candidates = [';', ',', '\t', '|']
  let best = ','
  let bestScore = -1

  for (const candidate of candidates) {
    const counts = lines.slice(0, 10).map((line) => splitLine(line, candidate).length)
    if (counts.length === 0) continue
    const max = Math.max(...counts)
    if (max < 2) continue
    const consistent = counts.filter((count) => count === max).length
    const score = max * consistent
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }
  return best
}

function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

const DATE_HEADERS = ['data', 'date', 'dt', 'datalancamento', 'datamovimento', 'datacompra']
const DESC_HEADERS = [
  'descricao','description','historico','lancamento','memo','estabelecimento',
  'detalhes','titulo','name','transacao',
]
const AMOUNT_HEADERS = ['valor', 'amount', 'value', 'montante', 'valorrs', 'valorbrl']
const DEBIT_HEADERS = ['debito', 'saida', 'debit']
const CREDIT_HEADERS = ['credito', 'entrada', 'credit']

function findHeader(headers: string[], candidates: string[]): string | undefined {
  const normalized = headers.map(normalizeHeader)
  for (const candidate of candidates) {
    const index = normalized.findIndex((h) => h === candidate)
    if (index >= 0) return headers[index]
  }
  for (const candidate of candidates) {
    const index = normalized.findIndex((h) => h.includes(candidate))
    if (index >= 0) return headers[index]
  }
  return undefined
}

/** Aceita DD/MM/AAAA, DD/MM/AA, DD-MM-AAAA e AAAA-MM-DD. */
export function parseCsvDate(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (iso) {
    const candidate = `${iso[1]}-${iso[2]}-${iso[3]}`
    return isValidDate(candidate) ? candidate : null
  }

  const br = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/.exec(value)
  if (br) {
    const [, d, m, y] = br
    if (!d || !m || !y) return null
    const year = y.length === 2 ? `20${y}` : y
    const candidate = `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
    return isValidDate(candidate) ? candidate : null
  }

  return null
}

export function parseCsv(content: string, mapping?: CsvMapping): CsvParseResult {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines.length < 2) {
    return { rows: [], headers: [], mapping: {}, skipped: 0 }
  }

  const delimiter = detectDelimiter(lines)

  // O cabecalho nem sempre e a primeira linha: extratos costumam abrir com
  // titulo, agencia e periodo. Procuramos a primeira linha que parece cabecalho.
  let headerIndex = 0
  let headers: string[] = []
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const candidate = splitLine(lines[i] as string, delimiter)
    if (candidate.length >= 2 && findHeader(candidate, DATE_HEADERS)) {
      headerIndex = i
      headers = candidate
      break
    }
  }
  if (headers.length === 0) headers = splitLine(lines[0] as string, delimiter)

  const resolved: CsvMapping = {
    date: mapping?.date ?? findHeader(headers, DATE_HEADERS),
    description: mapping?.description ?? findHeader(headers, DESC_HEADERS),
    amount: mapping?.amount ?? findHeader(headers, AMOUNT_HEADERS),
    debit: mapping?.debit ?? findHeader(headers, DEBIT_HEADERS),
    credit: mapping?.credit ?? findHeader(headers, CREDIT_HEADERS),
  }

  const indexOf = (name?: string): number => (name ? headers.indexOf(name) : -1)
  const dateIdx = indexOf(resolved.date)
  const descIdx = indexOf(resolved.description)
  const amountIdx = indexOf(resolved.amount)
  const debitIdx = indexOf(resolved.debit)
  const creditIdx = indexOf(resolved.credit)

  const rows: ParsedTransaction[] = []
  let skipped = 0

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const cells = splitLine(lines[i] as string, delimiter)
    const rawDate = dateIdx >= 0 ? cells[dateIdx] : undefined
    const date = rawDate ? parseCsvDate(rawDate) : null
    if (!date) {
      skipped++
      continue
    }

    let amount: number | null = null
    if (amountIdx >= 0 && cells[amountIdx]) {
      amount = parseAmount(cells[amountIdx] as string)
    }
    if (amount === null && (debitIdx >= 0 || creditIdx >= 0)) {
      const debit = debitIdx >= 0 ? parseAmount(cells[debitIdx] ?? '') : null
      const credit = creditIdx >= 0 ? parseAmount(cells[creditIdx] ?? '') : null
      if (debit) amount = -Math.abs(debit)
      else if (credit) amount = Math.abs(credit)
    }
    if (amount === null || !Number.isFinite(amount) || amount === 0) {
      skipped++
      continue
    }

    const description =
      (descIdx >= 0 ? cells[descIdx] : undefined)?.replace(/\s+/g, ' ').trim() || 'Lançamento'

    rows.push({ externalId: null, date, amount, description })
  }

  return { rows, headers, mapping: resolved, skipped }
}
