import { useState } from 'react'
import { Link, useLocation } from 'wouter'
import { addMonths, currentMonth, formatMonthLabel, formatRelative } from '@shared/dates'
import { formatBRL } from '@shared/money'
import { useBreakdown, useRunSync, useSummary } from '@/lib/queries'
import { OWNER_INITIAL, OWNER_NAME, greeting } from '@/lib/profile'
import Card from '@/components/Card'
import PaceCard from '@/components/PaceCard'
import BudgetMeter from '@/components/BudgetMeter'
import CompositionBar from '@/components/CompositionBar'
import TransactionRow from '@/components/TransactionRow'
import EmptyState from '@/components/EmptyState'
import Skeleton from '@/components/Skeleton'
import {
  IconAlert,
  IconChevron,
  IconPlus,
  IconSync,
  IconUpload,
} from '@/components/Icons'

/**
 * A tela que abre o app.
 *
 * O número herói é "quanto ainda posso gastar", não "quanto já gastei". Os dois
 * saem do mesmo dado, mas só o primeiro responde à pergunta que muda a decisão
 * de hoje. Exatamente UM número herói por tela.
 *
 * A ordem da página é a ordem da urgência: saudação e saldo, depois o que está
 * prestes a estourar, depois o que precisa de decisão, e só então o histórico.
 * Quem abre o app com pressa lê os dois primeiros blocos e fecha.
 */
export default function Summary() {
  const [month, setMonth] = useState(currentMonth)
  const [, setLocation] = useLocation()
  const summary = useSummary(month)
  const breakdown = useBreakdown(month)
  const sync = useRunSync()

  if (summary.isLoading && !summary.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-12 w-full" />
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
            className="pressable min-h-11 rounded-xl bg-[var(--cat-1)] px-5 text-sm font-semibold text-white"
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
  const isCurrentMonth = month === currentMonth()

  return (
    <div className={summary.isFetching ? 'opacity-60 transition-opacity' : undefined}>
      <Greeting />

      <MonthPicker month={month} onChange={setMonth} />

      <div className="mt-4 space-y-3">
        <HeroCard data={data} hasBudget={hasBudget} />

        {/* As três coisas que se faz num app de dinheiro sem estar procurando
            nada: lançar o que gastou agora, trazer o extrato, forçar o sync. */}
        {isCurrentMonth && (
          <div className="rise rise-2 flex gap-2">
            <QuickAction
              icon={<IconPlus className="h-[18px] w-[18px]" />}
              label="Lançar"
              onPress={() => setLocation('/transacoes?novo=1')}
            />
            <QuickAction
              icon={<IconUpload className="h-[18px] w-[18px]" />}
              label="Importar"
              onPress={() => setLocation('/ajustes')}
            />
            <QuickAction
              icon={<IconSync className="h-[18px] w-[18px]" spinning={sync.isPending} />}
              label={sync.isPending ? 'Sincronizando' : 'Sincronizar'}
              onPress={() => sync.mutate(false)}
              disabled={sync.isPending}
            />
          </div>
        )}

        {data.attention.length > 0 && (
          <div className="rise rise-3">
            <Card
              title="Precisa de atenção"
              action={
                <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--status-critical)_14%,transparent)] px-1.5 text-xs font-semibold text-[var(--status-critical)]">
                  {data.attention.length}
                </span>
              }
            >
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
          </div>
        )}

        <div className="rise rise-4">
          <PaceCard pace={data.pace} totalSpent={data.totalSpent} totalBudget={data.totalBudget} />
        </div>

        {data.uncategorizedCount > 0 && (
          <Link
            href="/transacoes?uncategorized=1"
            className="pressable rise rise-4 flex min-h-14 items-center gap-3 rounded-2xl bg-[var(--surface)] px-4 ring-1 ring-[var(--border)]"
            style={{ boxShadow: 'var(--shadow-sm)' }}
          >
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
              style={{
                background: 'color-mix(in srgb, var(--status-warning) 16%, transparent)',
                color: 'var(--status-warning)',
              }}
            >
              <IconAlert className="h-[18px] w-[18px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">
                {data.uncategorizedCount}{' '}
                {data.uncategorizedCount === 1 ? 'lançamento' : 'lançamentos'} sem categoria
              </span>
              <span className="block text-xs text-[var(--text-muted)]">
                categorize para o orçamento ficar fiel
              </span>
            </span>
            <IconChevron className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
          </Link>
        )}

        {breakdown.data && breakdown.data.length > 0 && (
          <div className="rise rise-5">
            <Card
              title="Para onde foi"
              action={
                <Link
                  href="/categorias"
                  className="text-xs font-semibold text-[var(--cat-1)]"
                >
                  ver tudo
                </Link>
              }
            >
              <CompositionBar items={breakdown.data} />
            </Card>
          </div>
        )}

        {data.recentTransactions.length > 0 ? (
          <div className="rise rise-6">
            <Card
              title="Últimos lançamentos"
              action={
                <Link href="/transacoes" className="text-xs font-semibold text-[var(--cat-1)]">
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
          </div>
        ) : (
          !hasMovement && (
            <EmptyState
              title="Nenhum lançamento neste mês"
              message="Importe o extrato do banco em Ajustes ou lance um gasto manualmente para começar."
              action={
                <Link
                  href="/ajustes"
                  className="pressable inline-flex min-h-11 items-center rounded-xl bg-[var(--cat-1)] px-5 text-sm font-semibold text-white"
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
    </div>
  )
}

// ---------------------------------------------------------------------------

/** Cabeçalho pessoal. É o que separa "um app" de "o meu app". */
function Greeting() {
  return (
    <header className="rise rise-1 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm text-[var(--text-secondary)]">{greeting()},</p>
        <h1 className="display truncate text-[1.75rem]">{OWNER_NAME}</h1>
      </div>

      {/* Avatar com a inicial. O degradê usa a cor do brand em duas opacidades:
          suficiente para dar volume, discreto o bastante para não competir com
          o número logo abaixo. */}
      <span
        aria-hidden="true"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-bold text-white"
        style={{
          background:
            'linear-gradient(140deg, var(--cat-1), color-mix(in srgb, var(--cat-1) 62%, var(--cat-7)))',
          fontFamily: 'var(--font-display)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        {OWNER_INITIAL}
      </span>
    </header>
  )
}

/**
 * Seletor de mês em pílula.
 *
 * Substitui as setas soltas de antes: agrupadas num controle só, elas param de
 * parecer dois botões perdidos e ganham a forma de um segmented control do iOS.
 */
function MonthPicker({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const canGoForward = month < currentMonth()

  return (
    <div className="rise rise-1 mt-4 flex items-center gap-2">
      <div className="inline-flex items-center gap-1 rounded-full bg-[var(--surface)] p-1 ring-1 ring-[var(--border)]">
        <button
          type="button"
          onClick={() => onChange(addMonths(month, -1))}
          aria-label="Mês anterior"
          className="pressable flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-secondary)]"
        >
          <IconChevron className="h-4 w-4 rotate-180" />
        </button>

        <span className="min-w-[8.5rem] text-center text-sm font-semibold capitalize">
          {formatMonthLabel(month)}
        </span>

        <button
          type="button"
          onClick={() => canGoForward && onChange(addMonths(month, 1))}
          disabled={!canGoForward}
          aria-label="Próximo mês"
          className="pressable flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-secondary)] disabled:opacity-25"
        >
          <IconChevron className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

/**
 * O cartão do número herói.
 *
 * Recebe o único degradê da tela. É deliberado: um só elemento com tratamento
 * especial vira hierarquia; o mesmo degradê repetido em cada cartão vira
 * papel de parede e não destaca nada.
 */
function HeroCard({
  data,
  hasBudget,
}: {
  data: NonNullable<ReturnType<typeof useSummary>['data']>
  hasBudget: boolean
}) {
  const over = data.remaining < 0

  if (!hasBudget) {
    return (
      <section
        className="rise rise-2 rounded-3xl p-5 ring-1 ring-[var(--border)]"
        style={{ background: 'var(--surface)', boxShadow: 'var(--shadow-md)' }}
      >
        <p className="overline text-[var(--text-muted)]">Gasto no mês</p>
        <p className="money-hero mt-2">{formatBRL(data.totalSpent)}</p>
        <Link
          href="/orcamentos"
          className="pressable mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--cat-1)] px-4 text-sm font-semibold text-white"
        >
          Definir orçamento
          <IconChevron className="h-4 w-4" />
        </Link>
      </section>
    )
  }

  const used = Math.min(1, data.pace.budgetUsed)

  return (
    <section
      className="rise rise-2 relative overflow-hidden rounded-3xl p-5 ring-1 ring-[var(--border)]"
      style={{
        background: over
          ? 'linear-gradient(155deg, color-mix(in srgb, var(--status-critical) 10%, var(--surface)), var(--surface) 65%)'
          : 'linear-gradient(155deg, color-mix(in srgb, var(--cat-1) 9%, var(--surface)), var(--surface) 65%)',
        boxShadow: 'var(--shadow-md)',
      }}
    >
      <p className="overline text-[var(--text-muted)]">
        {over ? 'Estourou o orçamento em' : 'Ainda posso gastar'}
      </p>

      <p
        className="money-hero mt-2"
        style={{ color: over ? 'var(--status-critical)' : 'var(--text-primary)' }}
      >
        {formatBRL(Math.abs(data.remaining))}
      </p>

      {/* Consumo do orçamento com a marca de onde o mês está.
          O número sozinho não diz se é muito: a régua é o tempo decorrido. */}
      <div className="mt-5">
        <div
          className="relative h-2 overflow-hidden rounded-full"
          style={{ background: 'color-mix(in srgb, var(--axis) 28%, transparent)' }}
        >
          <div
            className="h-full rounded-full"
            style={{
              width: `${used * 100}%`,
              background: over ? 'var(--status-critical)' : 'var(--cat-1)',
              transition: 'width var(--dur-slow) var(--ease-out)',
            }}
          />
          {/* O traço vertical é "hoje" na régua do mês. */}
          <span
            aria-hidden="true"
            className="absolute top-0 h-full w-0.5 rounded-full"
            style={{
              left: `${Math.min(99.5, data.pace.monthElapsed * 100)}%`,
              background: 'var(--text-primary)',
              opacity: 0.45,
            }}
          />
        </div>

        <p className="mt-2.5 flex items-center justify-between text-xs">
          <span className="text-[var(--text-secondary)]">
            <strong className="tabular font-semibold text-[var(--text-primary)]">
              {formatBRL(data.totalSpent)}
            </strong>{' '}
            de {formatBRL(data.totalBudget)}
          </span>
          <span className="tabular text-[var(--text-muted)]">
            {Math.round(data.pace.monthElapsed * 100)}% do mês
          </span>
        </p>
      </div>
    </section>
  )
}

function QuickAction({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: React.ReactNode
  label: string
  onPress: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      className="pressable flex flex-1 flex-col items-center justify-center gap-1.5 rounded-2xl bg-[var(--surface)] py-3 text-[var(--text-primary)] ring-1 ring-[var(--border)] disabled:opacity-50"
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      <span className="text-[var(--cat-1)]">{icon}</span>
      <span className="text-[0.6875rem] font-semibold">{label}</span>
    </button>
  )
}
