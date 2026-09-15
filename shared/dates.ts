/**
 * Datas no horario de Brasilia.
 *
 * O Brasil aboliu o horario de verao em 2019, entao BRT e um deslocamento FIXO
 * de UTC-3. Isso simplifica tudo: nao ha transicao de DST para tratar.
 *
 * Por que isso importa: o Pluggy devolve datas em UTC. Uma compra feita as 21h
 * de 31 de agosto em Brasilia chega como 2026-09-01T00:00:00Z. Sem converter na
 * INGESTAO, esse gasto cairia em setembro e o orcamento de agosto ficaria
 * errado. Por isso a coluna `date` guarda a data ja convertida, e nenhuma query
 * pode fazer date() sobre o valor UTC.
 */

export const BRT_OFFSET_HOURS = -3
const MS_PER_DAY = 86_400_000

/** Converte um instante ISO (UTC) para 'YYYY-MM-DD' no horario de Brasilia. */
export function utcToBrtDate(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  if (Number.isNaN(d.getTime())) throw new Error(`Data invalida: ${String(iso)}`)
  const shifted = new Date(d.getTime() + BRT_OFFSET_HOURS * 3600_000)
  return shifted.toISOString().slice(0, 10)
}

/** 'YYYY-MM-DD' de agora no horario de Brasilia. */
export function todayBrt(now: Date = new Date()): string {
  return utcToBrtDate(now)
}

/** 'YYYY-MM' do mes corrente em Brasilia. */
export function currentMonth(now: Date = new Date()): string {
  return todayBrt(now).slice(0, 7)
}

/** Mes de uma data 'YYYY-MM-DD'. */
export function monthOf(date: string): string {
  return date.slice(0, 7)
}

/** Primeiro e ultimo dia do mes, inclusivos, como 'YYYY-MM-DD'. */
export function monthBounds(month: string): { from: string; to: string } {
  assertMonth(month)
  const [y, m] = month.split('-').map(Number) as [number, number]
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return {
    from: `${month}-01`,
    to: `${month}-${String(last).padStart(2, '0')}`,
  }
}

export function daysInMonth(month: string): number {
  assertMonth(month)
  const [y, m] = month.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/**
 * Progresso do mes. Para meses passados devolve 1, para futuros 0 - assim o
 * indicador de ritmo nunca projeta besteira em meses que nao sao o corrente.
 */
export function monthProgress(
  month: string,
  now: Date = new Date(),
): { elapsed: number; dayOfMonth: number; daysLeft: number; total: number; isCurrent: boolean } {
  const total = daysInMonth(month)
  const today = todayBrt(now)
  const cur = today.slice(0, 7)

  if (month < cur) {
    return { elapsed: 1, dayOfMonth: total, daysLeft: 0, total, isCurrent: false }
  }
  if (month > cur) {
    return { elapsed: 0, dayOfMonth: 0, daysLeft: total, total, isCurrent: false }
  }

  const dayOfMonth = Number(today.slice(8, 10))
  return {
    elapsed: dayOfMonth / total,
    dayOfMonth,
    daysLeft: Math.max(0, total - dayOfMonth),
    total,
    isCurrent: true,
  }
}

/** Soma (ou subtrai) meses de um 'YYYY-MM'. */
export function addMonths(month: string, delta: number): string {
  assertMonth(month)
  const [y, m] = month.split('-').map(Number) as [number, number]
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Soma dias a uma data 'YYYY-MM-DD'. */
export function addDays(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  return new Date(d.getTime() + delta * MS_PER_DAY).toISOString().slice(0, 10)
}

/** "agosto de 2026" */
export function formatMonthLabel(month: string): string {
  assertMonth(month)
  const [y, m] = month.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** "05/08" ou "05/08/2025" se for de outro ano. */
export function formatDateShort(date: string, now: Date = new Date()): string {
  const [y, m, d] = date.split('-')
  if (!y || !m || !d) return date
  const currentYear = todayBrt(now).slice(0, 4)
  return y === currentYear ? `${d}/${m}` : `${d}/${m}/${y}`
}

/** "Hoje", "Ontem" ou "sex, 05/08" - cabecalho de grupo na lista. */
export function formatDayHeading(date: string, now: Date = new Date()): string {
  const today = todayBrt(now)
  if (date === today) return 'Hoje'
  if (date === addDays(today, -1)) return 'Ontem'
  const d = new Date(`${date}T12:00:00Z`)
  const weekday = d.toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' })
  return `${weekday.replace('.', '')}, ${formatDateShort(date, now)}`
}

/** "ha 3h", "ha 2 dias", "agora". */
export function formatRelative(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'nunca'
  const then = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z')
  if (Number.isNaN(then.getTime())) return 'nunca'
  const diffMin = Math.floor((now.getTime() - then.getTime()) / 60000)
  if (diffMin < 2) return 'agora'
  if (diffMin < 60) return `ha ${diffMin} min`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `ha ${diffH}h`
  const diffD = Math.floor(diffH / 24)
  return diffD === 1 ? 'ha 1 dia' : `ha ${diffD} dias`
}

export function isValidMonth(month: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month)
}

export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const d = new Date(`${date}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date
}

function assertMonth(month: string): void {
  if (!isValidMonth(month)) throw new Error(`Mes invalido: ${month} (esperado 'YYYY-MM')`)
}
