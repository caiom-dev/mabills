import { useMemo, useState } from 'react'
import { Link, useLocation } from 'wouter'
import { currentMonth } from '@shared/dates'
import type { BudgetProgress } from '@shared/types'
import { useBreakdown, useBudgets, useTrends } from '@/lib/queries'
import MonthSwitcher from '@/components/MonthSwitcher'
import Card from '@/components/Card'
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
  const budgets = useBudgets(month)
  const breakdown = useBreakdown(month)
  const trends = useTrends(6)

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
      <MonthSwitcher month={month} onChange={setMonth} />

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

      {trends.data && trends.data.length > 1 && (
        <Card title="Últimos meses">
          <TrendChart data={trends.data} />
        </Card>
      )}
    </div>
  )
}
