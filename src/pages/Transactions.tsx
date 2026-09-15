import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useSearch } from 'wouter'
import type { Transaction, TransactionTotals } from '@shared/types'
import { currentMonth, formatDayHeading, todayBrt } from '@shared/dates'
import { formatBRL, parseAmount } from '@shared/money'
import {
  useCategories,
  useCreateTransaction,
  useDeleteTransaction,
  useTransactions,
  useUpdateTransaction,
} from '@/lib/queries'
import MonthSwitcher from '@/components/MonthSwitcher'
import { catVar } from '@/lib/theme'
import { IconDonut } from '@/components/Icons'
import Card from '@/components/Card'
import Sheet from '@/components/Sheet'
import CategoryPicker from '@/components/CategoryPicker'
import TransactionRow from '@/components/TransactionRow'
import EmptyState from '@/components/EmptyState'
import Skeleton from '@/components/Skeleton'

const PAGE_SIZE = 100

/** Deriva um padrao de regra a partir da descricao, igual ao backend faz. */
function suggestPattern(description: string): string {
  const cleaned = description
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\d+/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.split(' ').slice(0, 2).join(' ')
}

export default function Transactions() {
  const search = useSearch()
  const params = useMemo(() => new URLSearchParams(search), [search])

  const [month, setMonth] = useState(currentMonth)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [editing, setEditing] = useState<Transaction | null>(null)
  /*
   * ?novo=1 ja abre o formulario de lancamento.
   *
   * E o que faz a acao rapida "Lancar" da tela inicial valer a pena: sem isto
   * ela so trocaria de aba e deixaria o usuario procurar o botao. Inicializador
   * preguicoso do useState, e nao useEffect, para o formulario vir no primeiro
   * quadro em vez de piscar a lista antes.
   */
  const [creating, setCreating] = useState(() => new URLSearchParams(search).get('novo') === '1')
  const [pickingCategory, setPickingCategory] = useState(false)
  const [, setLocation] = useLocation()

  const categoryId = params.get('categoryId') ? Number(params.get('categoryId')) : null
  const uncategorized = params.get('uncategorized') === '1'

  // Debounce: buscar a cada tecla dispararia uma requisicao por caractere.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300)
    return () => clearTimeout(timer)
  }, [query])

  const filters = {
    month,
    categoryId,
    q: debouncedQuery || undefined,
    uncategorized: uncategorized || undefined,
    limit,
  }
  const list = useTransactions(filters)

  const { data: categories = [] } = useCategories()
  const filtered = categoryId ? categories.find((c) => c.id === categoryId) : undefined

  const groups = useMemo(() => {
    const map = new Map<string, Transaction[]>()
    for (const tx of list.data?.items ?? []) {
      const bucket = map.get(tx.date)
      if (bucket) bucket.push(tx)
      else map.set(tx.date, [tx])
    }
    return [...map.entries()]
  }, [list.data])

  return (
    <div className="space-y-4">
      {/* Uma unica linha de filtros, acima de tudo que eles afetam. */}
      <MonthSwitcher month={month} onChange={setMonth} />

      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        type="search"
        placeholder="Buscar lançamento"
        aria-label="Buscar lançamento"
        className="min-h-11 w-full rounded-xl bg-[var(--surface)] px-4 text-base ring-1 ring-[var(--border)] outline-none focus:ring-2 focus:ring-[var(--cat-1)]"
      />

      {/* Linha de filtro.
          Antes só existia um rótulo passivo dizendo "Filtrado por categoria":
          dava para SAIR do filtro, nunca para ENTRAR nele. Filtrar por
          categoria só era possível chegando de um link de outra tela. */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setPickingCategory(true)}
          className="pressable inline-flex min-h-11 items-center gap-2 rounded-full bg-[var(--surface)] px-3.5 text-sm ring-1 ring-[var(--border)]"
        >
          {filtered ? (
            <>
              <span
                aria-hidden="true"
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: catVar(filtered.colorSlot) }}
              />
              <span className="max-w-[10rem] truncate font-semibold">{filtered.name}</span>
            </>
          ) : (
            <>
              <IconDonut className="h-4 w-4 text-[var(--text-muted)]" />
              <span className="text-[var(--text-secondary)]">Categoria</span>
            </>
          )}
        </button>

        {(categoryId || uncategorized) && (
          /* Link, e nao <a>: uma ancora nativa faz o navegador RECARREGAR o
             app inteiro em vez de trocar de rota. Num PWA instalado isso tanto
             descarta o estado da tela (mes escolhido, busca, rolagem) quanto
             expoe o app a um recarregamento com service worker no meio de uma
             atualizacao - que foi como esta tela acabou toda cinza, exigindo
             fechar e reabrir o app. Era a unica ancora interna que restava. */
          <Link
            href="/transacoes"
            className="pressable inline-flex min-h-11 items-center gap-1.5 rounded-full bg-[var(--page)] px-3 text-xs text-[var(--text-secondary)] ring-1 ring-[var(--border)]"
          >
            {uncategorized ? 'só sem categoria' : 'limpar filtro'} ×
          </Link>
        )}
      </div>

      <Sheet
        open={pickingCategory}
        onClose={() => setPickingCategory(false)}
        title="Filtrar por categoria"
      >
        {/* Sem `kind`: aqui aparecem TODAS, inclusive transferência e receita.
            São justamente as que somem das telas de análise, e eram as únicas
            que não davam para inspecionar. */}
        <CategoryPicker
          value={categoryId}
          onChange={(id) => {
            setLocation(id ? `/transacoes?categoryId=${id}` : '/transacoes')
            setPickingCategory(false)
          }}
        />
      </Sheet>

      {/* O painel que explica a diferença entre o extrato e o total do mês. */}
      {filtered && list.data && <CategoryTotals totals={list.data.totals} />}

      {list.isLoading && !list.data ? (
        <Skeleton className="h-72 w-full" />
      ) : groups.length === 0 ? (
        <EmptyState
          title="Nenhum lançamento"
          message="Ajuste os filtros, importe um extrato em Ajustes ou lance um gasto no botão +."
        />
      ) : (
        <div className={list.isFetching ? 'opacity-60 transition-opacity' : ''}>
          {groups.map(([date, items]) => {
            const dayTotal = items.reduce((sum, tx) => sum + (tx.isIgnored ? 0 : tx.amount), 0)
            return (
              <Card key={date} className="mb-3">
                <div className="mb-1 flex items-baseline justify-between gap-3">
                  <h3 className="text-xs font-semibold text-[var(--text-secondary)]">
                    {formatDayHeading(date)}
                  </h3>
                  <span className="text-xs tabular text-[var(--text-muted)]">
                    {formatBRL(dayTotal)}
                  </span>
                </div>
                <div className="divide-y divide-[var(--border)]">
                  {items.map((tx) => (
                    <TransactionRow key={tx.id} tx={tx} onPress={setEditing} />
                  ))}
                </div>
              </Card>
            )
          })}

          {/* "Carregar mais" em vez de scroll infinito: previsivel e nao rouba o
              controle do polegar no meio da leitura. */}
          {list.data?.hasMore && (
            <button
              type="button"
              onClick={() => setLimit((value) => value + PAGE_SIZE)}
              className="min-h-11 w-full rounded-xl bg-[var(--surface)] text-sm text-[var(--cat-1)] ring-1 ring-[var(--border)]"
            >
              Carregar mais
            </button>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setCreating(true)}
        aria-label="Novo lançamento"
        className="fixed right-5 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--cat-1)] text-3xl leading-none text-white shadow-lg active:opacity-80"
        style={{ bottom: 'calc(5rem + var(--safe-bottom))' }}
      >
        +
      </button>

      {editing && <EditSheet tx={editing} onClose={() => setEditing(null)} />}
      {creating && <CreateSheet month={month} onClose={() => setCreating(false)} />}
    </div>
  )
}

// ---------------------------------------------------------------------------

function EditSheet({ tx, onClose }: { tx: Transaction; onClose: () => void }) {
  const [categoryId, setCategoryId] = useState<number | null>(tx.categoryId)
  const [isIgnored, setIsIgnored] = useState(tx.isIgnored)
  const [notes, setNotes] = useState(tx.notes ?? '')
  const [createRule, setCreateRule] = useState(false)
  const [pattern, setPattern] = useState(() => suggestPattern(tx.description))
  const [result, setResult] = useState<string | null>(null)

  const update = useUpdateTransaction()
  const remove = useDeleteTransaction()
  const categoryChanged = categoryId !== tx.categoryId

  function save() {
    update.mutate(
      {
        id: tx.id,
        body: {
          categoryId,
          isIgnored,
          notes: notes.trim() || null,
          createRule: createRule && categoryId !== null,
          rulePattern: pattern.trim() || undefined,
        },
      },
      {
        onSuccess: (response) => {
          if (response.ruleCreated) {
            setResult(
              `Regra criada · ${response.backfilled} ${
                response.backfilled === 1 ? 'lançamento recategorizado' : 'lançamentos recategorizados'
              }`,
            )
            setTimeout(onClose, 1400)
          } else {
            onClose()
          }
        },
      },
    )
  }

  return (
    <Sheet open onClose={onClose} title="Editar lançamento">
      <p className="text-sm font-medium">{tx.description}</p>
      <p className="mb-4 text-sm text-[var(--text-secondary)]">
        {formatBRL(tx.amount)} · {tx.accountName ?? 'conta'}
      </p>

      <h3 className="mb-2 text-xs font-semibold text-[var(--text-secondary)]">Categoria</h3>
      <CategoryPicker value={categoryId} onChange={setCategoryId} />

      {/* O atalho que faz a categorizacao ficar boa em duas semanas em vez de
          nunca: uma correcao vira regra permanente. */}
      {categoryChanged && categoryId !== null && (
        <div className="mt-4 rounded-xl bg-[var(--page)] p-3">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={createRule}
              onChange={(event) => setCreateRule(event.target.checked)}
              className="mt-0.5 h-5 w-5 accent-[var(--cat-1)]"
            />
            <span>
              Aplicar a todos os lançamentos parecidos
              <span className="block text-xs text-[var(--text-muted)]">
                Cria uma regra e recategoriza o histórico.
              </span>
            </span>
          </label>
          {createRule && (
            <input
              value={pattern}
              onChange={(event) => setPattern(event.target.value)}
              aria-label="Texto da regra"
              className="mt-2 min-h-11 w-full rounded-lg bg-[var(--surface)] px-3 text-base ring-1 ring-[var(--border)] outline-none focus:ring-2 focus:ring-[var(--cat-1)]"
            />
          )}
        </div>
      )}

      <label className="mt-4 flex min-h-11 items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={isIgnored}
          onChange={(event) => setIsIgnored(event.target.checked)}
          className="h-5 w-5 accent-[var(--cat-1)]"
        />
        <span>
          Ignorar no orçamento
          <span className="block text-xs text-[var(--text-muted)]">
            Para transferências entre contas suas.
          </span>
        </span>
      </label>

      <input
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder="Observação (opcional)"
        aria-label="Observação"
        className="mt-3 min-h-11 w-full rounded-xl bg-[var(--page)] px-3 text-base ring-1 ring-[var(--border)] outline-none focus:ring-2 focus:ring-[var(--cat-1)]"
      />

      {result && <p className="mt-3 text-sm text-[var(--success-text)]">{result}</p>}
      {update.error && (
        <p className="mt-3 text-sm text-[var(--status-critical)]">{update.error.message}</p>
      )}

      <div className="mt-5 flex gap-2 pb-2">
        <button
          type="button"
          onClick={save}
          disabled={update.isPending}
          className="min-h-12 flex-1 rounded-xl bg-[var(--cat-1)] text-sm font-medium text-white disabled:opacity-50"
        >
          {update.isPending ? 'Salvando…' : 'Salvar'}
        </button>
        {tx.isManual && (
          <button
            type="button"
            onClick={() => {
              if (confirm('Apagar este lançamento?')) {
                remove.mutate(tx.id, { onSuccess: onClose })
              }
            }}
            className="min-h-12 rounded-xl px-4 text-sm text-[var(--status-critical)] ring-1 ring-[var(--border)]"
          >
            Apagar
          </button>
        )}
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------

function CreateSheet({ month, onClose }: { month: string; onClose: () => void }) {
  const today = todayBrt()
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(() => (month === currentMonth() ? today : `${month}-01`))
  const [kind, setKind] = useState<'expense' | 'income'>('expense')
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const create = useCreateTransaction()

  const parsed = parseAmount(amount)
  const valid = parsed !== null && parsed > 0 && description.trim().length > 0

  return (
    <Sheet open onClose={onClose} title="Novo lançamento">
      <div className="flex gap-2">
        {(['expense', 'income'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setKind(option)}
            aria-pressed={kind === option}
            className={`min-h-11 flex-1 rounded-xl text-sm ${
              kind === option
                ? 'bg-[var(--text-primary)] text-[var(--surface)]'
                : 'bg-[var(--page)] text-[var(--text-secondary)] ring-1 ring-[var(--border)]'
            }`}
          >
            {option === 'expense' ? 'Gasto' : 'Receita'}
          </button>
        ))}
      </div>

      <label className="mt-4 block text-xs font-semibold text-[var(--text-secondary)]">
        Valor
        <div className="mt-1 flex items-center gap-2">
          <span className="text-sm text-[var(--text-muted)]">R$</span>
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            autoFocus
            placeholder="0,00"
            className="min-h-12 w-full rounded-xl bg-[var(--page)] px-3 text-lg tabular ring-1 ring-[var(--border)] outline-none focus:ring-2 focus:ring-[var(--cat-1)]"
          />
        </div>
      </label>

      <label className="mt-3 block text-xs font-semibold text-[var(--text-secondary)]">
        Descrição
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Onde foi o gasto"
          className="mt-1 min-h-11 w-full rounded-xl bg-[var(--page)] px-3 text-base ring-1 ring-[var(--border)] outline-none focus:ring-2 focus:ring-[var(--cat-1)]"
        />
      </label>

      <label className="mt-3 block text-xs font-semibold text-[var(--text-secondary)]">
        Data
        <input
          type="date"
          value={date}
          max={today}
          onChange={(event) => setDate(event.target.value)}
          className="mt-1 min-h-11 w-full rounded-xl bg-[var(--page)] px-3 text-base ring-1 ring-[var(--border)] outline-none focus:ring-2 focus:ring-[var(--cat-1)]"
        />
      </label>

      <h3 className="mt-4 mb-2 text-xs font-semibold text-[var(--text-secondary)]">Categoria</h3>
      <CategoryPicker
        value={categoryId}
        onChange={setCategoryId}
        kind={kind === 'income' ? 'income' : undefined}
      />

      {create.error && (
        <p className="mt-3 text-sm text-[var(--status-critical)]">{create.error.message}</p>
      )}

      <button
        type="button"
        disabled={!valid || create.isPending}
        onClick={() =>
          create.mutate(
            {
              date,
              amount: parsed as number,
              description: description.trim(),
              categoryId,
              kind,
            },
            { onSuccess: onClose },
          )
        }
        className="mt-5 mb-2 min-h-12 w-full rounded-xl bg-[var(--cat-1)] text-sm font-medium text-white disabled:opacity-45"
      >
        {create.isPending ? 'Salvando…' : 'Adicionar'}
      </button>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------

/**
 * Totais da categoria filtrada.
 *
 * O ponto deste painel é uma linha só: quanto do que saiu NÃO entra no total do
 * mês. Sem ela, quem soma os lançamentos na mão e compara com a tela inicial
 * encontra uma diferença de milhares de reais e conclui que o app erra a conta
 * — quando na verdade ele está certo, e apenas não explicava a exclusão.
 */
function CategoryTotals({ totals }: { totals: TransactionTotals }) {
  const conta = totals.spent - totals.outOfMonthTotal
  const temExclusao = totals.outOfMonthTotal > 0

  return (
    <div
      className="rounded-[1.25rem] bg-[var(--surface)] p-4 ring-1 ring-[var(--border)]"
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="overline text-[var(--text-muted)]">Saiu da conta</span>
        <span className="display-sm tabular text-lg">{formatBRL(totals.spent)}</span>
      </div>

      {totals.income > 0 && (
        <div className="mt-2 flex items-baseline justify-between gap-3">
          <span className="text-sm text-[var(--text-secondary)]">Entrou</span>
          <span className="tabular text-sm font-semibold text-[var(--success-text)]">
            {formatBRL(totals.income)}
          </span>
        </div>
      )}

      {temExclusao && (
        <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm text-[var(--text-secondary)]">
              Fora do total do mês
              <span className="ml-1 text-xs text-[var(--text-muted)]">
                ({totals.outOfMonthCount})
              </span>
            </span>
            <span className="tabular text-sm font-semibold text-[var(--text-muted)]">
              −{formatBRL(totals.outOfMonthTotal)}
            </span>
          </div>

          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-semibold">Conta como gasto</span>
            <span className="tabular text-sm font-semibold">{formatBRL(conta)}</span>
          </div>

          <p className="text-xs text-[var(--text-muted)]">
            Transferências e lançamentos marcados como “ignorar no orçamento” aparecem na lista,
            mas não somam no gasto do mês.
          </p>
        </div>
      )}
    </div>
  )
}
