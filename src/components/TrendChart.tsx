import type { MonthTrend } from '@shared/types'
import { formatBRLCompact } from '@shared/money'
import { currentMonth } from '@shared/dates'

/**
 * Gasto por mes, em colunas.
 *
 * SVG puro em vez de biblioteca de graficos: sao seis barras, e controlar o
 * layout na mao evita o defeito classico de container com altura fixa que corta
 * a faixa de rotulos do eixo e cria um scroll interno.
 *
 * Uma cor so. Meses nao sao categorias nominais competindo por identidade -
 * pintar cada barra de uma cor gastaria o unico canal livre com informacao que
 * o comprimento da barra ja transmite.
 */
export default function TrendChart({ data }: { data: MonthTrend[] }) {
  if (data.length === 0) return null

  const max = Math.max(...data.map((item) => item.totalSpent), 1)
  const now = currentMonth()

  return (
    <div>
      <div className="flex h-32 items-end gap-2">
        {data.map((item) => {
          const isCurrent = item.month === now
          const height = Math.max((item.totalSpent / max) * 100, item.totalSpent > 0 ? 3 : 0)
          return (
            <div key={item.month} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              {/* Rotulo direto SO no mes corrente. Numero em toda barra vira
                  ruido e ninguem le. */}
              <span
                className={`h-4 text-[10px] tabular ${
                  isCurrent ? 'text-[var(--text-secondary)]' : 'text-transparent'
                }`}
              >
                {isCurrent ? formatBRLCompact(item.totalSpent) : '.'}
              </span>
              <div className="flex w-full flex-1 items-end justify-center">
                <div
                  className="w-full max-w-6 rounded-t"
                  style={{
                    height: `${height}%`,
                    background: isCurrent ? 'var(--cat-1)' : 'var(--axis)',
                  }}
                  title={`${item.month}: ${formatBRLCompact(item.totalSpent)}`}
                />
              </div>
            </div>
          )
        })}
      </div>

      {/* Linha de base: hairline solido, nunca tracejado. */}
      <div className="h-px w-full bg-[var(--gridline)]" />

      <div className="mt-1 flex gap-2">
        {data.map((item) => (
          <span
            key={item.month}
            className="min-w-0 flex-1 text-center text-[10px] text-[var(--text-muted)]"
          >
            {item.month.slice(5)}
          </span>
        ))}
      </div>
    </div>
  )
}
