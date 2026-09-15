import { useState } from 'react'
import { todayBrt } from '@shared/dates'
import { formatBRL, parseAmount } from '@shared/money'
import { useBalance, useCategories, useCreatePot, useDeletePot } from '@/lib/queries'
import { catVar } from '@/lib/theme'
import Card from './Card'
import Skeleton from './Skeleton'

/**
 * Configuração dos cofrinhos.
 *
 * Um cofrinho é uma categoria com saldo acompanhado. Aqui se escolhe QUAL
 * categoria cumpre esse papel e quanto já havia guardado antes de o app ver o
 * extrato.
 *
 * O saldo inicial é o campo que evita o erro mais perigoso da tela: o sync só
 * traz os últimos 35 dias. Sem informá-lo, quem guarda dinheiro há um ano veria
 * uma fração do que tem — e um saldo errado com aparência de certo é pior que
 * saldo nenhum.
 */
export default function PotsSection() {
  const categories = useCategories()
  const balance = useBalance()
  const create = useCreatePot()
  const remove = useDeletePot()

  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [opening, setOpening] = useState('')
  const [goal, setGoal] = useState('')

  if (categories.isLoading || balance.isLoading) return <Skeleton className="h-40 w-full" />

  const pots = balance.data?.pots ?? []
  const jaCofrinho = new Set(pots.map((p) => p.categoryId))

  // Só categorias que ainda não são cofrinho. Arquivadas ficam de fora.
  const disponiveis = (categories.data ?? []).filter(
    (c) => !c.isArchived && !jaCofrinho.has(c.id),
  )

  const openingValue = parseAmount(opening)
  const goalValue = goal.trim() ? parseAmount(goal) : null
  const podeCriar =
    categoryId !== null && openingValue !== null && openingValue >= 0 && !create.isPending

  return (
    <Card title="Cofrinhos">
      <p className="text-sm text-[var(--text-secondary)]">
        Dinheiro que saiu da conta mas continua seu. Ao marcar um lançamento com a categoria do
        cofrinho, o valor deixa de contar como gasto e passa a somar no saldo guardado.
      </p>

      {pots.length > 0 && (
        <ul className="mt-3 divide-y divide-[var(--border)]">
          {pots.map((pot) => (
            <li key={pot.categoryId} className="flex items-center gap-3 py-2.5">
              <span
                aria-hidden="true"
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: catVar(pot.colorSlot) }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{pot.name}</span>
                <span className="block text-xs text-[var(--text-muted)]">
                  abertura {formatBRL(pot.openingBalance)} · {pot.txCount}{' '}
                  {pot.txCount === 1 ? 'movimentação' : 'movimentações'}
                </span>
              </span>
              <span className="tabular shrink-0 text-sm font-semibold">
                {formatBRL(pot.balance)}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Parar de acompanhar o cofrinho “${pot.name}”?`)) {
                    remove.mutate(pot.categoryId)
                  }
                }}
                className="min-h-11 shrink-0 px-2 text-xs text-[var(--status-critical)]"
              >
                parar
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 rounded-xl bg-[var(--page)] p-3">
        <label className="block text-xs font-semibold text-[var(--text-secondary)]">
          Categoria do cofrinho
        </label>
        <select
          value={categoryId ?? ''}
          onChange={(event) => setCategoryId(event.target.value ? Number(event.target.value) : null)}
          className="mt-1 min-h-12 w-full rounded-lg bg-[var(--surface)] px-3 text-base ring-1 ring-[var(--border)] outline-none focus:ring-2 focus:ring-[var(--cat-1)]"
        >
          <option value="">escolha uma categoria…</option>
          {disponiveis.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <label className="mt-3 block text-xs font-semibold text-[var(--text-secondary)]">
          Quanto já está guardado hoje
        </label>
        <input
          value={opening}
          onChange={(event) => setOpening(event.target.value)}
          inputMode="decimal"
          placeholder="0,00"
          className="mt-1 min-h-12 w-full rounded-lg bg-[var(--surface)] px-3 text-base tabular ring-1 ring-[var(--border)] outline-none focus:ring-2 focus:ring-[var(--cat-1)]"
        />
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Olhe o valor no app do banco. O extrato só traz os últimos 35 dias — sem este número, o
          que você guardou antes disso ficaria de fora da conta.
        </p>

        <label className="mt-3 block text-xs font-semibold text-[var(--text-secondary)]">
          Meta <span className="font-normal text-[var(--text-muted)]">(opcional)</span>
        </label>
        <input
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          inputMode="decimal"
          placeholder="sem meta"
          className="mt-1 min-h-12 w-full rounded-lg bg-[var(--surface)] px-3 text-base tabular ring-1 ring-[var(--border)] outline-none focus:ring-2 focus:ring-[var(--cat-1)]"
        />

        <button
          type="button"
          disabled={!podeCriar}
          onClick={() =>
            create.mutate(
              {
                categoryId: categoryId as number,
                openingBalance: openingValue as number,
                openingDate: todayBrt(),
                goal: goalValue,
              },
              {
                onSuccess: () => {
                  setCategoryId(null)
                  setOpening('')
                  setGoal('')
                },
              },
            )
          }
          className="pressable mt-3 min-h-12 w-full rounded-xl bg-[var(--cat-1)] text-sm font-semibold text-white disabled:opacity-45"
        >
          {create.isPending ? 'Salvando…' : 'Acompanhar como cofrinho'}
        </button>

        {create.error && (
          <p role="alert" className="mt-2 text-sm text-[var(--status-critical)]">
            {create.error.message}
          </p>
        )}
      </div>
    </Card>
  )
}
