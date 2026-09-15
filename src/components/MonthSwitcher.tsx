import { addMonths, currentMonth, formatMonthLabel } from '@shared/dates'

export default function MonthSwitcher({
  month,
  onChange,
}: {
  month: string
  onChange: (month: string) => void
}) {
  const now = currentMonth()
  // Navegar para o futuro so mostraria telas vazias.
  const canGoForward = month < now

  return (
    <div className="flex items-center justify-between gap-2">
      <button
        type="button"
        onClick={() => onChange(addMonths(month, -1))}
        aria-label="Mês anterior"
        className="flex h-11 w-11 items-center justify-center rounded-full text-xl text-[var(--text-secondary)] active:opacity-60"
      >
        ‹
      </button>

      <span className="text-base font-semibold capitalize">{formatMonthLabel(month)}</span>

      <button
        type="button"
        onClick={() => canGoForward && onChange(addMonths(month, 1))}
        disabled={!canGoForward}
        aria-label="Próximo mês"
        className="flex h-11 w-11 items-center justify-center rounded-full text-xl text-[var(--text-secondary)] active:opacity-60 disabled:opacity-25"
      >
        ›
      </button>
    </div>
  )
}
