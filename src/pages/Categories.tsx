import { useMemo, useState } from 'react'
import { Link, useLocation } from 'wouter'
import { currentMonth } from '@shared/dates'
import type { BudgetProgress } from '@shared/types'
import { formatBRL } from '@shared/money'
import { useBreakdown, useBreakdownOutOfMonth, useBudgets, useTrends } from '@/lib/queries'
import { catVar } from '@/lib/theme'
import { IconChevron } from '@/components/Icons'
import MonthSwitcher from '@/components/MonthSwitcher'
import Card from '@/components/Card'
import Sheet from '@/components/Sheet'
import CategoryForm from '@/components/CategoryForm'
import { IconPlus } from '@/components/Icons'
import BudgetMeter from '@/components/BudgetMeter'
import CompositionBar from '@/components/CompositionBar'
import TrendChart from '@/components/TrendChart'
import EmptyState from '@/components/EmptyState'
import Skeleton from '@/components/Skeleton'

/**
 * Lista ordenada de medidores.
 *
 * Nao e um grafico de rosca de proposito: com 8+ categorias, comparar angulos
 * proximos e mais dificil que comparar barras, e cores adjacentes borram. A
 * lista tambem responde de graca a segunda pergunta ("qual esta estourando?"),
 * porque a ordenacao e por percentual consumido.
 */
export default function Categories() {
  const [month, setMonth] = useState(currentMonth)
  const [, setLocation] = useLocation()
  const [creating, setCreating] = useState(false)
  const budgets = useBudgets(month)
  const breakdown = useBreakdown(month)
  const fora = useBreakdownOutOfMonth(month)
  const trends = useTrends(6)

  const totalFora = (fora.data ?? []).reduce((soma, item) => soma + item.spent, 0)

  const sorted = useMemo(() => {
    const items = [...(budgets.data ?? [])]
    return items.sort((a, b) => {
      const aHas = a.limitAmount !== null && a.limitAmount > 0
      const bHas = b.limitAmount !== null && b.limitAmount > 0
      // Categorias com teto vem primeiro, ordenadas pelo quanto ja consumiram.
      // Sem teto nao ha "estourando", entao elas caem para o fim, por gasto.
      if (aHas && bHas) return (b.percent ?? 0) - (a.percent ?? 0)
      if (aHas !== bHas) return aHas ? -1 : 1
      return b.spent - a.spent
    })
  }, [budgets.data])

  const withMovement = sorted.filter(
    (item) => item.spent > 0 || (item.limitAmount !== null && item.limitAmount > 0),
  )

  if (budgets.isLoading && !budgets.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className={`space-y-4 ${budgets.isFetching ? 'opacity-60 transition-opacity' : ''}`}>
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <MonthSwitcher month={month} onChange={setMonth} />
        </div>
        {/* Criar categoria mora AQUI, e não só no fim de Ajustes: esta é a tela
            em que se olha para a lista e se percebe que falta uma. */}
        <button
          type="button"
          onClick={() => setCreating(true)}
          aria-label="Nova categoria"
          className="pressable flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--cat-1)] text-white"
          style={{ boxShadow: 'var(--shadow-sm)' }}
        >
          <IconPlus className="h-5 w-5" />
        </button>
      </div>

      <Sheet open={creating} onClose={() => setCreating(false)} title="Nova categoria">
        <CategoryForm autoFocus onCreated={() => setCreating(false)} />
      </Sheet>

      {breakdown.data && breakdown.data.length > 0 && (
        <Card title="Composição do mês">
          <CompositionBar items={breakdown.data} />
        </Card>
      )}

      {withMovement.length > 0 ? (
        <Card
          title="Por categoria"
          action={
            <Link href="/orcamentos" className="text-xs text-[var(--cat-1)]">
              definir tetos
            </Link>
          }
        >
          <div className="divide-y divide-[var(--border)]">
            {withMovement.map((item: BudgetProgress) => (
              <BudgetMeter
                key={item.categoryId}
                item={item}
                onPress={() => setLocation(`/transacoes?categoryId=${item.categoryId}`)}
              />
            ))}
          </div>
        </Card>
      ) : (
        <EmptyState
          title="Sem gastos neste mês"
          message="Assim que houver lançamentos, eles aparecem aqui agrupados por categoria."
        />
      )}

      {/* O que o total do mês não soma.
          Tirar transferências do total foi a correção certa, mas levou junto a
          única forma de enxergá-las: elas não aparecem em "Por categoria"
          (que só traz kind='expense') nem na composição. Esta seção devolve a
          visibilidade sem devolver o problema — os valores são mostrados, e
          continuam fora da conta. */}
      {fora.data && fora.data.length > 0 && (
        <Card
          title="Fora do total do mês"
          action={
            <span className="tabular text-xs font-semibold text-[var(--text-muted)]">
              {formatBRL(totalFora)}
            </span>
          }
        >
          <ul className="divide-y divide-[var(--border)]">
            {fora.data.map((item) => (
              <li key={item.categoryId ?? 'sem'}>
                <button
                  type="button"
                  onClick={() =>
                    setLocation(
                      item.categoryId ? `/transacoes?categoryId=${item.categoryId}` : '/transacoes',
                    )
                  }
                  className="pressable flex w-full items-center gap-3 py-3 text-left"
                >
                  <span
                    aria-hidden="true"
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: catVar(item.colorSlot) }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{item.categoryName}</span>
                    <span className="block text-xs text-[var(--text-muted)]">
                      {item.txCount} {item.txCount === 1 ? 'lançamento' : 'lançamentos'}
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-sm font-semibold text-[var(--text-secondary)]">
                    {formatBRL(item.spent)}
                  </span>
                  <IconChevron className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
                </button>
              </li>
            ))}
          </ul>

          <p className="mt-3 border-t border-[var(--border)] pt-3 text-xs text-[var(--text-muted)]">
            Transferências entre contas suas, pagamento de fatura e lançamentos marcados como
            “ignorar no orçamento”. Toque para ver os lançamentos.
          </p>
        </Card>
      )}

      {trends.data && trends.data.length > 1 && (
        <Card title="Últimos meses">
          <TrendChart data={trends.data} />
        </Card>
      )}
    </div>
  )
}
