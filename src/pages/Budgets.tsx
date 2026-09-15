import { useEffect, useMemo, useState } from 'react'
import { currentMonth, formatMonthLabel } from '@shared/dates'
import { formatAmount, formatBRL, parseAmount } from '@shared/money'
import { useBudgets, useBudgetSuggestions, useDeleteBudget, useUpsertBudget } from '@/lib/queries'
import MonthSwitcher from '@/components/MonthSwitcher'
import Card from '@/components/Card'
import CategoryDot from '@/components/CategoryDot'
import Skeleton from '@/components/Skeleton'

/**
 * Definicao de tetos.
 *
 * O conceito menos obvio do app e o escopo: por padrao um teto vale para TODOS
 * os meses (month = '*'). Isso evita ter que redefinir doze vezes por ano, mas
 * precisa estar escrito na tela, senao o usuario acha que configurou so agosto.
 */
export default function Budgets() {
  const [month, setMonth] = useState(currentMonth)
  const [scopeThisMonth, setScopeThisMonth] = useState(false)
  const budgets = useBudgets(month)
  const suggestions = useBudgetSuggestions(month)
  const upsert = useUpsertBudget()
  const remove = useDeleteBudget()

  const scope = scopeThisMonth ? month : '*'

  const suggestionMap = useMemo(() => {
    const map = new Map<number, { suggested: number; months: number }>()
    for (const item of suggestions.data ?? []) {
      map.set(item.categoryId, { suggested: item.suggested, months: item.monthsConsidered })
    }
    return map
  }, [suggestions.data])

  const totalBudget = (budgets.data ?? []).reduce((sum, item) => sum + (item.limitAmount ?? 0), 0)

  if (budgets.isLoading && !budgets.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <MonthSwitcher month={month} onChange={setMonth} />

      <Card>
        <p className="text-sm text-[var(--text-secondary)]">Orçamento total definido</p>
        <p className="mt-1 text-2xl font-semibold">{formatBRL(totalBudget)}</p>

        <label className="mt-4 flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={scopeThisMonth}
            onChange={(event) => setScopeThisMonth(event.target.checked)}
            className="h-5 w-5 accent-[var(--cat-1)]"
          />
          <span>
            Aplicar só em {formatMonthLabel(month)}
            <span className="block text-xs text-[var(--text-muted)]">
              {scopeThisMonth
                ? 'A alteração vale apenas neste mês.'
                : 'Sem marcar, o teto vale como padrão para todos os meses.'}
            </span>
          </span>
        </label>
      </Card>

      <Card title="Teto por categoria">
        <ul className="divide-y divide-[var(--border)]">
          {(budgets.data ?? []).map((item) => (
            <BudgetRow
              key={item.categoryId}
              categoryId={item.categoryId}
              name={item.categoryName}
              colorSlot={item.colorSlot}
              spent={item.spent}
              limit={item.limitAmount}
              suggestion={suggestionMap.get(item.categoryId)}
              onSave={(value) =>
                upsert.mutate({ categoryId: item.categoryId, month: scope, limitAmount: value })
              }
              onClear={() => remove.mutate({ categoryId: item.categoryId, month: scope })}
            />
          ))}
        </ul>
      </Card>
    </div>
  )
}

function BudgetRow({
  name,
  colorSlot,
  spent,
  limit,
  suggestion,
  onSave,
  onClear,
}: {
  categoryId: number
  name: string
  colorSlot: number
  spent: number
  limit: number | null
  suggestion?: { suggested: number; months: number }
  onSave: (value: number) => void
  onClear: () => void
}) {
  const [draft, setDraft] = useState(limit !== null ? formatAmount(limit) : '')
  const [saved, setSaved] = useState(false)

  // Reflete valor vindo do servidor (ex.: apos aceitar sugestao), sem apagar o
  // que o usuario esta digitando.
  useEffect(() => {
    setDraft(limit !== null ? formatAmount(limit) : '')
  }, [limit])

  useEffect(() => {
    if (!saved) return undefined
    const timer = setTimeout(() => setSaved(false), 1600)
    return () => clearTimeout(timer)
  }, [saved])

  function commit() {
    const trimmed = draft.trim()
    if (!trimmed) {
      if (limit !== null) {
        onClear()
        setSaved(true)
      }
      return
    }
    const value = parseAmount(trimmed)
    if (value === null || value < 0) {
      setDraft(limit !== null ? formatAmount(limit) : '')
      return
    }
    if (limit !== null && Math.abs(value - limit) < 0.005) return
    onSave(value)
    setSaved(true)
  }

  return (
    <li className="py-3">
      <div className="flex items-center gap-3">
        <CategoryDot slot={colorSlot} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{name}</span>
          <span className="block text-xs text-[var(--text-muted)]">
            gasto: {formatBRL(spent)}
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-1">
          <span className="text-xs text-[var(--text-muted)]">R$</span>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
            inputMode="decimal"
            placeholder="—"
            aria-label={`Teto para ${name}`}
            className="min-h-11 w-24 rounded-xl bg-[var(--page)] px-3 text-right text-base tabular ring-1 ring-[var(--border)] outline-none focus:ring-2 focus:ring-[var(--cat-1)]"
          />
        </span>
      </div>

      {saved && (
        <p className="mt-1 text-right text-xs text-[var(--success-text)]">salvo</p>
      )}

      {/* Tirar o numero do nada e o que trava as pessoas; a media dos meses
          anteriores da um ponto de partida honesto. */}
      {limit === null && suggestion && suggestion.suggested > 0 && (
        <button
          type="button"
          onClick={() => onSave(suggestion.suggested)}
          className="mt-1 min-h-11 text-xs text-[var(--cat-1)]"
        >
          sugestão: {formatBRL(suggestion.suggested)} (média de {suggestion.months}{' '}
          {suggestion.months === 1 ? 'mês' : 'meses'}) — usar
        </button>
      )}
    </li>
  )
}
