import type { Pace } from '@shared/types'
import { formatBRL } from '@shared/money'
import Card from './Card'

/**
 * O aviso que chega ANTES do estouro.
 *
 * Avisar depois que estourou nao muda comportamento - o dinheiro ja saiu. Este
 * cartao compara quanto do orcamento foi consumido com quanto do mes ja passou,
 * e traduz isso na unica pergunta acionavel: quanto da para gastar por dia no
 * resto do mes sem estourar.
 */

const TONE: Record<Pace['status'], { color: string; label: string }> = {
  acelerado: { color: 'var(--status-critical)', label: 'Ritmo acelerado' },
  no_ritmo: { color: 'var(--cat-1)', label: 'No ritmo' },
  tranquilo: { color: 'var(--status-good)', label: 'Ritmo tranquilo' },
  sem_orcamento: { color: 'var(--cat-0)', label: 'Sem orçamento definido' },
}

export default function PaceCard({
  pace,
  totalSpent,
  totalBudget,
}: {
  pace: Pace
  totalSpent: number
  totalBudget: number
}) {
  const tone = TONE[pace.status]

  if (pace.status === 'sem_orcamento') {
    return (
      <Card>
        <p className="text-sm text-[var(--text-secondary)]">
          Defina um teto por categoria para o app avisar quando o ritmo de gastos estiver alto —
          antes de estourar.
        </p>
      </Card>
    )
  }

  const message =
    pace.status === 'acelerado'
      ? `Mantido esse ritmo, o mês fecha em ${formatBRL(pace.projectedSpend)} — ${formatBRL(
          pace.projectedOverspend,
        )} acima do orçamento.`
      : `Você gastou ${formatBRL(totalSpent)} de ${formatBRL(totalBudget)}.`

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* Estado sempre com rotulo: nunca so pela cor. */}
          <p className="flex items-center gap-2 text-sm font-semibold">
            <span
              aria-hidden="true"
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ background: tone.color }}
            />
            {tone.label}
          </p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">{message}</p>
        </div>
      </div>

      {pace.daysLeft > 0 && (
        <p className="mt-3 border-t border-[var(--border)] pt-3 text-sm">
          <span className="text-[var(--text-secondary)]">
            Dá para gastar até{' '}
          </span>
          <strong className="tabular">{formatBRL(pace.safeDailySpend)}</strong>
          <span className="text-[var(--text-secondary)]">
            {' '}
            por dia nos {pace.daysLeft} dias que faltam.
          </span>
        </p>
      )}

      {/* Duas barras finas comparando consumo do orçamento com avanço do mês.
          A comparação é o dado; sozinho, cada número não diz nada. */}
      <div className="mt-3 space-y-2">
        <MiniBar
          label="orçamento usado"
          value={pace.budgetUsed}
          color={tone.color}
        />
        <MiniBar label="mês decorrido" value={pace.monthElapsed} color="var(--axis)" />
      </div>
    </Card>
  )
}

function MiniBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full"
        style={{ background: 'color-mix(in srgb, var(--axis) 30%, transparent)' }}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(100, value * 100)}%`, background: color }}
        />
      </div>
      <span className="w-32 shrink-0 text-xs text-[var(--text-muted)]">
        <span className="tabular">{Math.round(value * 100)}%</span> {label}
      </span>
    </div>
  )
}
