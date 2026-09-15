import { useState } from 'react'
import { Link, useLocation } from 'wouter'
import { currentMonth, formatRelative } from '@shared/dates'
import { formatBRL } from '@shared/money'
import { useBreakdown, useSummary } from '@/lib/queries'
import MonthSwitcher from '@/components/MonthSwitcher'
import Card from '@/components/Card'
import Money from '@/components/Money'
import PaceCard from '@/components/PaceCard'
import BudgetMeter from '@/components/BudgetMeter'
import CompositionBar from '@/components/CompositionBar'
import TransactionRow from '@/components/TransactionRow'
import EmptyState from '@/components/EmptyState'
import Skeleton from '@/components/Skeleton'

/**
 * A tela que abre o app.
 *
 * O numero heroi e "quanto ainda posso gastar", nao "quanto ja gastei". Os dois
 * saem do mesmo dado, mas so o primeiro responde a pergunta que muda a decisao
 * de hoje. Exatamente UM numero heroi por tela.
 */
export default function Summary() {
  const [month, setMonth] = useState(currentMonth)
  const [, setLocation] = useLocation()
  const summary = useSummary(month)
  const breakdown = useBreakdown(month)

  if (summary.isLoading && !summary.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  if (summary.isError && !summary.data) {
    return (
      <EmptyState
        title="Não consegui carregar"
        message={summary.error?.message ?? 'Tente novamente em instantes.'}
        action={
          <button
            type="button"
            onClick={() => void summary.refetch()}
            className="min-h-11 rounded-xl bg-[var(--cat-1)] px-5 text-sm font-medium text-white"
          >
            Tentar de novo
          </button>
        }
      />
    )
  }

  const data = summary.data
  if (!data) return null

  const hasBudget = data.totalBudget > 0
  const hasMovement = data.totalSpent > 0 || data.totalIncome > 0

  return (
    // Durante o refetch o conteudo antigo permanece, so esmaecido. Trocar por
    // esqueleto a cada mudanca de mes faria a tela piscar.
    <div className={`space-y-4 ${summary.isFetching ? 'opacity-60 transition-opacity' : ''}`}>
      <MonthSwitcher month={month} onChange={setMonth} />

      <Card>
        {hasBudget ? (
          <>
            <p className="text-sm text-[var(--text-secondary)]">Ainda posso gastar</p>
            <Money
              value={data.remaining}
              size="hero"
              tone={data.remaining < 0 ? 'critical' : 'neutral'}
              className="mt-1 block !text-[var(--text-primary)]"
            />
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              de {formatBRL(data.totalBudget)} de orçamento ·{' '}
              <strong className="font-medium text-[var(--text-primary)]">
                {formatBRL(data.totalSpent)}
              </strong>{' '}
              já gastos
            </p>
            {data.remaining < 0 && (
              <p className="mt-1 text-sm font-medium text-[var(--status-critical)]">
                Orçamento estourado em {formatBRL(Math.abs(data.remaining))}.
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-sm text-[var(--text-secondary)]">Gasto no mês</p>
            <Money value={data.totalSpent} size="hero" tone="neutral" className="mt-1 block !text-[var(--text-primary)]" />
            <Link
              href="/orcamentos"
              className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-[var(--cat-1)] px-4 text-sm font-medium text-white"
            >
              Definir orçamento
            </Link>
          </>
        )}
      </Card>

      <PaceCard pace={data.pace} totalSpent={data.totalSpent} totalBudget={data.totalBudget} />

      {data.attention.length > 0 && (
        <Card title="Atenção">
          <div className="divide-y divide-[var(--border)]">
            {data.attention.map((item) => (
              <BudgetMeter
                key={item.categoryId}
                item={item}
                onPress={() => setLocation(`/transacoes?categoryId=${item.categoryId}`)}
              />
            ))}
          </div>
        </Card>
      )}

      {data.uncategorizedCount > 0 && (
        <Link
          href="/transacoes?uncategorized=1"
          className="flex min-h-11 items-center justify-between gap-3 rounded-2xl bg-[var(--surface)] p-4 ring-1 ring-[var(--border)]"
        >
          <span className="text-sm text-[var(--text-secondary)]">
            {data.uncategorizedCount}{' '}
            {data.uncategorizedCount === 1 ? 'lançamento sem categoria' : 'lançamentos sem categoria'}
          </span>
          <span aria-hidden="true" className="text-[var(--text-muted)]">
            ›
          </span>
        </Link>
      )}

      {breakdown.data && breakdown.data.length > 0 && (
        <Card title="Para onde foi" action={<Link href="/categorias" className="text-xs text-[var(--cat-1)]">ver tudo</Link>}>
          <CompositionBar items={breakdown.data} />
        </Card>
      )}

      {data.recentTransactions.length > 0 ? (
        <Card
          title="Últimos lançamentos"
          action={
            <Link href="/transacoes" className="text-xs text-[var(--cat-1)]">
              ver todos
            </Link>
          }
        >
          <div className="divide-y divide-[var(--border)]">
            {data.recentTransactions.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} />
            ))}
          </div>
        </Card>
      ) : (
        !hasMovement && (
          <EmptyState
            title="Nenhum lançamento neste mês"
            message="Importe o extrato do banco em Ajustes ou lance um gasto manualmente para começar."
            action={
              <Link
                href="/ajustes"
                className="inline-flex min-h-11 items-center rounded-xl bg-[var(--cat-1)] px-5 text-sm font-medium text-white"
              >
                Importar extrato
              </Link>
            }
          />
        )
      )}

      <p className="pb-2 text-center text-xs text-[var(--text-muted)]">
        atualizado {formatRelative(data.lastSyncAt)}
      </p>
    </div>
  )
}
