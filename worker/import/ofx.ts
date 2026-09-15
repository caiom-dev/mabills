/**
 * Parser de OFX.
 *
 * OFX e SGML, nao XML: as tags de valor normalmente NAO sao fechadas e o valor
 * termina na quebra de linha ou na proxima tag. Jogar isso num parser de XML
 * falha em praticamente todo extrato de banco brasileiro - por isso a extracao
 * e feita por regex sobre os blocos <STMTTRN>.
 *
 * O OFX e o formato preferido para importar porque traz <FITID>, um id estavel
 * por transacao. Com ele, reimportar o mesmo arquivo nunca duplica nada.
 */

import type { ParsedTransaction } from '@shared/types'
import { round2 } from '@shared/money'

/** Le uma tag de valor: `<TAG>conteudo` ate a quebra de linha ou proxima tag. */
function field(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([^<\r\n]*)`, 'i').exec(block)
  const value = match?.[1]?.trim()
  return value ? value : null
}

/**
 * Converte DTPOSTED para 'YYYY-MM-DD' no horario de Brasilia.
 *
 * Formatos vistos na pratica: YYYYMMDD, YYYYMMDDHHMMSS, com sufixo opcional
 * `.000` e `[-3:BRT]`.
 *
 * Quando o deslocamento declarado ja e -3, ou quando nao ha hora nenhuma, a data
 * e usada como esta. Converter nesse caso deslocaria o lancamento em um dia sem
 * motivo - um erro pior que nao converter.
 */
export function parseOfxDate(raw: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2}))?/.exec(raw.trim())
  if (!match) return null

  const [, year, month, day, hour, minute, second] = match
  if (!year || !month || !day) return null

  const plain = `${year}-${month}-${day}`
  if (!hour) return plain

  const offsetMatch = /\[([+-]?\d+(?:\.\d+)?):?[A-Z]*\]/.exec(raw)
  const offset = offsetMatch?.[1] ? Number.parseFloat(offsetMatch[1]) : -3
  if (!Number.isFinite(offset) || offset === -3) return plain

  const utc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour) - offset,
    Number(minute ?? '0'),
    Number(second ?? '0'),
  )
  return new Date(utc - 3 * 3600_000).toISOString().slice(0, 10)
}

/** Detecta se o conteudo e OFX, para escolher o parser sem depender da extensao. */
export function looksLikeOfx(content: string): boolean {
  const head = content.slice(0, 2048).toUpperCase()
  return head.includes('OFXHEADER') || head.includes('<OFX>') || head.includes('<STMTTRN>')
}

export function parseOfx(content: string): ParsedTransaction[] {
  const transactions: ParsedTransaction[] = []
  // `[\s\S]` em vez de `.` porque o bloco atravessa varias linhas.
  const blocks = content.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)

  for (const block of blocks) {
    const body = block[1]
    if (!body) continue

    const rawDate = field(body, 'DTPOSTED') ?? field(body, 'DTUSER')
    const rawAmount = field(body, 'TRNAMT')
    if (!rawDate || !rawAmount) continue

    const date = parseOfxDate(rawDate)
    // O OFX usa ponto decimal, mas ha exportadores que emitem virgula.
    const amount = Number.parseFloat(rawAmount.replace(',', '.'))
    if (!date || !Number.isFinite(amount)) continue

    const description =
      field(body, 'MEMO') ?? field(body, 'NAME') ?? field(body, 'TRNTYPE') ?? 'Lançamento'
    const fitId = field(body, 'FITID')

    transactions.push({
      externalId: fitId ? `ofx_${fitId}` : null,
      date,
      amount: round2(amount),
      description: description.replace(/\s+/g, ' ').trim(),
    })
  }

  return transactions
}
