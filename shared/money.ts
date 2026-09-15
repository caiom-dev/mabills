/**
 * Dinheiro.
 *
 * Valores sao guardados como REAL (double) no D1, nao como centavos inteiros.
 * Isso e seguro aqui porque todo valor passa por `round2` na ingestao e na
 * agregacao: com ~1000 transacoes por mes o erro acumulado de ponto flutuante
 * fica na ordem de 1e-10, e arredondar o total para 2 casas devolve o valor
 * exato. A alternativa (centavos inteiros) adicionaria atrito em toda query
 * sem ganho pratico nesta escala.
 */

/** Arredonda para 2 casas. Use em TODA fronteira: ingestao, soma, resposta. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

const BRL_NO_SYMBOL = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** "R$ 1.234,56" */
export function formatBRL(n: number): string {
  return BRL.format(round2(n))
}

/** "1.234,56" - sem simbolo, para colunas e campos de entrada. */
export function formatAmount(n: number): string {
  return BRL_NO_SYMBOL.format(round2(n))
}

/**
 * Versao curta para numeros grandes em espaco apertado: "R$ 1,2 mil".
 * Abaixo de mil devolve o valor cheio, porque encurtar ali perde precisao sem
 * ganhar espaco.
 */
export function formatBRLCompact(n: number): string {
  const abs = Math.abs(n)
  if (abs < 1000) return formatBRL(n)
  if (abs < 1_000_000) {
    const v = n / 1000
    return `R$ ${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`
  }
  const v = n / 1_000_000
  return `R$ ${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
}

/**
 * Le um valor digitado por humano em pt-BR.
 * Aceita "1.234,56", "1234,56", "1234.56", "R$ 1.234,56" e "-50".
 * Devolve null se nao for um numero valido.
 */
export function parseAmount(input: string): number | null {
  if (typeof input !== 'string') return null
  let s = input.trim().replace(/\s/g, '').replace(/R\$/gi, '')
  if (!s) return null

  const negative = s.startsWith('-') || /^\(.*\)$/.test(s)
  s = s.replace(/[()]/g, '').replace(/^[-+]/, '')

  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')

  if (lastComma > -1 && lastDot > -1) {
    // O separador decimal e o que aparece por ultimo.
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.')
    else s = s.replace(/,/g, '')
  } else if (lastComma > -1) {
    // Virgula sozinha: decimal se tiver ate 2 digitos depois, senao milhar.
    const decimals = s.length - lastComma - 1
    s = decimals > 0 && decimals <= 2 ? s.replace(',', '.') : s.replace(/,/g, '')
  } else if (lastDot > -1) {
    const decimals = s.length - lastDot - 1
    // "1.234" em pt-BR e mil duzentos e trinta e quatro, nao 1,234.
    if (decimals === 3 && (s.match(/\./g)?.length ?? 0) >= 1 && s.length > 4) {
      s = s.replace(/\./g, '')
    }
  }

  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return round2(negative ? -n : n)
}

/** Percentual como 0..1 -> "45%". */
export function formatPercent(fraction: number, digits = 0): string {
  return `${(fraction * 100).toLocaleString('pt-BR', {
    maximumFractionDigits: digits,
  })}%`
}
