import type { BudgetProgress } from '@shared/types'
import { formatBRL } from '@shared/money'
import CategoryDot from './CategoryDot'

/**
 * O componente central do app: responde "estou estourando?" de relance.
 *
 * Duas decisoes de cor que parecem detalhe e nao sao:
 *
 * 1. O PREENCHIMENTO carrega severidade (azul ok -> ambar atencao -> vermelho
 *    estourado), nao identidade. Se cada barra usasse a cor da sua categoria,
 *    oito medidores empilhados virariam oito cores brigando, sem hierarquia, e
 *    a que importa (a estourada) nao saltaria.
 * 2. A IDENTIDADE fica no ponto colorido ao lado do nome.
 *
 * E o estado tambem aparece em TEXTO. Cor sozinha nao carrega significado -
 * tres dos oito matizes ficam abaixo de 3:1 de contraste no modo claro.
 */

const STATE_COLOR: Record<BudgetProgress['state'], string> = {
  ok: 'var(--cat-1)',
  atencao: 'var(--status-warning)',
  estourado: 'var(--status-critical)',
  sem_orcamento: 'var(--cat-0)',
}

function stateLabel(item: BudgetProgress): string {
  if (item.state === 'sem_orcamento' || item.limitAmount === null) return 'sem orçamento'
  const remaining = item.remaining ?? 0
  if (remaining < 0) return `${formatBRL(Math.abs(remaining))} acima do limite`
  return `restam ${formatBRL(remaining)}`
}

export default function BudgetMeter({
  item,
  onPress,
}: {
  item: BudgetProgress
  onPress?: () => void
}) {
  const hasBudget = item.limitAmount !== null && item.limitAmount > 0
  const percent = item.percent ?? 0
  // A barra para em 100%; o excedente e comunicado pelo texto. Deixar a barra
  // passar do trilho ficaria ilegivel e nao diria quanto passou.
  const width = hasBudget ? Math.min(100, Math.max(percent * 100, percent > 0 ? 2 : 0)) : 0
  const color = STATE_COLOR[item.state]

  const Wrapper = onPress ? 'button' : 'div'

  return (
    <Wrapper
      {...(onPress ? { type: 'button' as const, onClick: onPress } : {})}
      className={`flex w-full min-h-11 flex-col gap-1.5 py-2 text-left ${
        onPress ? 'active:opacity-70' : ''
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <CategoryDot slot={item.colorSlot} />
          <span className="truncate text-sm font-medium text-[var(--text-primary)]">
            {item.categoryName}
          </span>
        </span>
        <span className="shrink-0 text-sm tabular text-[var(--text-primary)]">
          {formatBRL(item.spent)}
          {hasBudget && (
            <span className="text-[var(--text-muted)]">
              {' / '}
              {formatBRL(item.limitAmount as number)}
            </span>
          )}
        </span>
      </div>

      {hasBudget && (
        <div
          className="h-1.5 w-full overflow-hidden rounded-full"
          // Trilho = a propria cor de preenchimento em opacidade baixa, para o
          // estado ser legivel ao longo de toda a barra.
          style={{ background: `color-mix(in srgb, ${color} 18%, transparent)` }}
          role="progressbar"
          aria-valuenow={Math.round(percent * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${item.categoryName}: ${stateLabel(item)}`}
        >
          <div
            className="h-full rounded-full transition-[width] duration-300"
            style={{ width: `${width}%`, background: color }}
          />
        </div>
      )}

      <div className="flex items-center justify-between gap-2 text-xs">
        <span
          className={
            item.state === 'estourado'
              ? 'font-medium text-[var(--status-critical)]'
              : 'text-[var(--text-muted)]'
          }
        >
          {stateLabel(item)}
        </span>
        {hasBudget && (
          <span className="tabular text-[var(--text-muted)]">{Math.round(percent * 100)}%</span>
        )}
      </div>
    </Wrapper>
  )
}
