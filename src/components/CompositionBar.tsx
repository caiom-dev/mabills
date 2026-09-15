import { useMemo } from 'react'
import type { CategoryBreakdown } from '@shared/types'
import { MAX_CHART_SLICES } from '@shared/palette'
import { formatBRL, formatPercent } from '@shared/money'
import { catVar } from '@/lib/theme'
import CategoryDot from './CategoryDot'

/**
 * Parte-do-todo em barra horizontal empilhada.
 *
 * Nao e rosca nem pizza de proposito: com mais de ~6 fatias as classes adjacentes
 * borram e comparar angulos proximos e mais dificil que comparar comprimentos.
 * O excedente e dobrado em "Outros" - gerar um 9o matiz produziria uma cor
 * indistinguivel das existentes sob daltonismo.
 *
 * A separacao entre segmentos e um GAP na cor da superficie, nunca uma borda
 * desenhada: borda adiciona tinta que nao e dado.
 */
export default function CompositionBar({ items }: { items: CategoryBreakdown[] }) {
  const segments = useMemo(() => {
    const spending = items.filter((item) => item.spent > 0).sort((a, b) => b.spent - a.spent)
    if (spending.length <= MAX_CHART_SLICES) return spending

    const head = spending.slice(0, MAX_CHART_SLICES - 1)
    const tail = spending.slice(MAX_CHART_SLICES - 1)
    return [
      ...head,
      {
        categoryId: null,
        categoryName: 'Outros',
        colorSlot: 0,
        spent: tail.reduce((sum, item) => sum + item.spent, 0),
        share: tail.reduce((sum, item) => sum + item.share, 0),
        txCount: tail.reduce((sum, item) => sum + item.txCount, 0),
      } satisfies CategoryBreakdown,
    ]
  }, [items])

  const total = segments.reduce((sum, item) => sum + item.spent, 0)
  if (total <= 0) return null

  return (
    <div>
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full">
        {segments.map((segment) => (
          <div
            key={segment.categoryId ?? segment.categoryName}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{
              width: `${(segment.spent / total) * 100}%`,
              background: catVar(segment.colorSlot),
            }}
            title={`${segment.categoryName}: ${formatBRL(segment.spent)}`}
          />
        ))}
      </div>

      {/* Legenda sempre presente: a identidade nunca depende so da cor. */}
      <ul className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {segments.map((segment) => (
          <li
            key={segment.categoryId ?? segment.categoryName}
            className="flex items-center justify-between gap-2 text-xs"
          >
            <span className="flex min-w-0 items-center gap-2">
              <CategoryDot slot={segment.colorSlot} size={8} />
              <span className="truncate text-[var(--text-secondary)]">{segment.categoryName}</span>
            </span>
            <span className="shrink-0 tabular text-[var(--text-muted)]">
              {formatPercent(segment.spent / total)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
