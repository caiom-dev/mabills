/**
 * Normalizacao de texto de extrato bancario.
 *
 * Por que este arquivo importa tanto: o campo `category` do Pluggy exige plano
 * pago e chega NULO no plano gratuito. Sobra o texto da transacao - e texto de
 * extrato brasileiro e lixo previsivel:
 *
 *   "COMPRA COM CARTAO 05/08 IFOOD *IFOOD CLUB 000012345678"
 *   "PIX ENVIADO 04/08 JOAO DA SILVA 12345678901"
 *   "PAG*99APP 01/12"
 *
 * Quanto melhor a limpeza, melhor a categorizacao automatica. E como as regras
 * comparam texto normalizado dos dois lados (padrao e descricao), a normalizacao
 * precisa ser deterministica e idempotente.
 *
 * ATENCAO: `cleanDescription` NAO deve ser usada para produzir o texto que
 * alimenta o motor de regras. O motor usa `normalizeText` sobre a descricao
 * ORIGINAL, senao padroes legitimos como 'pagamento fatura' ou 'pix' sumiriam
 * junto com o ruido. A limpeza serve para exibicao e para sugerir padroes.
 */

/**
 * Minusculas e sem diacriticos, mas com a pontuacao intacta.
 * Etapa intermediaria: alguns ruidos ('05/08/2025', '01/12') so sao
 * reconheciveis enquanto a pontuacao ainda existe.
 */
function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/**
 * Minusculas, sem acento, sem pontuacao e com espacos colapsados.
 *
 * A pontuacao vira ESPACO em vez de sumir: "PAG*IFOOD" precisa virar
 * "pag ifood" e nao "pagifood", senao a regra 'ifood' (contains) nao casa.
 * Apostrofos sao a excecao - somem sem deixar espaco, para "mc donald's"
 * continuar sendo "mc donalds".
 */
export function normalizeText(s: string): string {
  if (typeof s !== 'string' || s.length === 0) return ''
  return stripDiacritics(s)
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Ruido que depende da pontuacao original. Aplicado ANTES de `normalizeText`,
 * porque depois disso '05/08/2025' ja virou '05 08 2025' e vira indistinguivel
 * de numeros legitimos.
 */
const RAW_NOISE: RegExp[] = [
  // Datas completas: 05/08/2025, 05-08-25, 2025-08-05.
  /\b\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}\b/g,
  /\b\d{4}[/.\-]\d{1,2}[/.\-]\d{1,2}\b/g,
  // Parcelamento explicito: "parcela 1 de 12", "parc 01/12".
  /\bparc(?:ela)?s?\s*\.?\s*\d{1,2}\s*(?:de|\/)\s*\d{1,2}\b/g,
  // Parcelamento implicito e data curta: "01/12", "05-08".
  /\b\d{1,2}\s*[/\-]\s*\d{1,2}\b/g,
  // Ids e datas grudadas (ddmmaaaa, aaaammdd, nsu, cpf).
  /\b\d{5,}\b/g,
]

/**
 * Ruido de vocabulario, aplicado sobre o texto ja normalizado.
 * A ordem importa: as expressoes mais especificas vem primeiro, senao
 * '\bcartao\b' comeria a palavra antes de 'compra com cartao' ser reconhecida.
 */
const TEXT_NOISE: RegExp[] = [
  /\bcompra\s+(?:com|no|na|c)?\s*cart(?:ao|oes)\b/g,
  /\bcompra\s+(?:nacional|internacional)\b/g,
  /\bcompra\s+aprovada\b/g,
  /\bcart(?:ao|oes)\s+de\s+(?:credito|debito)\b/g,
  /\bpix\s+(?:enviado|recebido|env|rec|qrs|qr|des|transf|transferencia|saque|troco|devolucao)\b/g,
  /\b(?:debito|credito)\s+(?:automatico|em\s+conta)\b/g,
  /\btarifa(?:\s+bancaria|\s+mensal(?:idade)?)?\b/g,
  /\bparcela\s+\d{1,2}\s+de\s+\d{1,2}\b/g,
  /\bparcela\s+\d{1,2}\b/g,
  /\b(?:pagamento|pagamentos|pagto|pgto|pag)\b/g,
  /\b(?:debito|credito)\b/g,
  /\bcart(?:ao|oes)\b/g,
  /\bsaque\b/g,
]

/**
 * Tira o ruido tipico de extrato e devolve o que sobra - normalmente o nome do
 * estabelecimento. Se a limpeza consumir tudo (ex.: "PAGAMENTO DEBITO"), devolve
 * o texto normalizado inteiro: e melhor um rotulo generico do que vazio.
 */
export function cleanDescription(s: string): string {
  if (typeof s !== 'string') return ''
  const normalized = normalizeText(s)
  if (!normalized) return ''

  let t = stripDiacritics(s)
  for (const re of RAW_NOISE) t = t.replace(re, ' ')

  t = normalizeText(t)
  for (const re of TEXT_NOISE) t = t.replace(re, ' ')

  t = t.replace(/\s+/g, ' ').trim()
  // Sobras de prefixo depois que a expressao maior foi removida.
  t = t.replace(/^(?:compra|pix|compras)\s+/, '')
  // Numero solto no fim quase sempre e sequencial de terminal/agencia.
  t = t.replace(/\s+\d{1,4}$/, '').trim()

  return t || normalized
}

/**
 * Palavras que nunca devem ABRIR um padrao de regra. So sao descartadas do
 * inicio: tirar do meio quebraria o `contains` ('pao de acucar' viraria
 * 'pao acucar', que nao existe em lugar nenhum do extrato).
 */
const LEADING_STOPWORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'nos', 'nas',
  'a', 'o', 'os', 'as', 'um', 'uma', 'por', 'para', 'com', 'ao',
  'ltda', 'me', 'sa', 'eireli', 'mei', 'cia', 'the',
])

/**
 * Deriva o padrao de regra a partir de uma descricao. E o que alimenta o atalho
 * "aplicar a todas as futuras".
 *
 * Heuristica de tamanho: marca forte se resolve sozinha ('ifood', 'drogaria'),
 * senao junta a proxima palavra ('uber eats', 'mc donalds') e no maximo tres
 * ('pao de acucar'). Palavras vizinhas sao sempre CONTIGUAS para o padrao
 * continuar existindo literalmente no texto normalizado.
 */
export function suggestRulePattern(description: string): string {
  const cleaned = cleanDescription(description)
  if (!cleaned) return ''

  const words = cleaned.split(' ').filter(Boolean)
  let start = 0
  while (start < words.length) {
    const w = words[start]
    if (w === undefined) break
    // Digito longo no inicio e id; '99' (99app, 99 tecnologia) fica.
    if (LEADING_STOPWORDS.has(w) || /^\d{4,}$/.test(w)) start++
    else break
  }
  if (start >= words.length) start = 0

  const picked: string[] = []
  let len = 0
  for (let i = start; i < words.length && picked.length < 3; i++) {
    const w = words[i]
    if (w === undefined) break
    picked.push(w)
    len += w.length
    if (picked.length === 1 && len >= 5) break
    if (picked.length === 2 && len >= 8) break
  }

  return picked.join(' ').trim() || cleaned
}
