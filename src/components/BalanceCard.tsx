import { useState } from 'react'
import type { BalanceSummary } from '@shared/types'
import { formatBRL } from '@shared/money'
import { catVar } from '@/lib/theme'
import { IconChevron } from './Icons'

/**
 * Saldo disponível, guardado e total.
 *
 * Duas respostas diferentes que importam pelos dois lados: quem vai gastar
 * precisa saber o que tem na conta HOJE; quem quer saber quanto tem, precisa
 * do total. Mostrar só um dos dois esconde metade — e é o defeito que este
 * card resolve: no extrato do banco, o dinheiro do cofrinho simplesmente
 * sumiu da conta corrente.
 *
 * O número em destaque é o DISPONÍVEL, não o total. É ele que responde à
 * pergunta que muda a decisão de hoje; o total vem logo abaixo, sem competir.
 */
export default function BalanceCard({ data }: { data: BalanceSummary }) {
  const [aberto, setAberto] = useState(false)
  const temCofrinho = data.pots.length > 0

  return (
    <section
      className="rounded-[1.25rem] bg-[var(--surface)] p-4 ring-1 ring-[var(--border)]"
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="overline text-[var(--text-muted)]">Disponível na conta</span>
        <span className="display-sm tabular text-lg">{formatBRL(data.available)}</span>
      </div>

      {temCofrinho && (
        <>
          <div className="mt-2 flex items-baseline justify-between gap-3">
            <span className="text-sm text-[var(--text-secondary)]">Guardado em cofrinhos</span>
            <span className="tabular text-sm font-semibold text-[var(--cat-3)]">
              {formatBRL(data.inPots)}
            </span>
          </div>

          <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-[var(--border)] pt-3">
            <span className="text-sm font-semibold">Total</span>
            <span className="display-sm tabular text-lg">{formatBRL(data.total)}</span>
          </div>

          {/* A lista fica recolhida: com um cofrinho ela é supérflua, com
              cinco ela empurraria o resto da tela para fora da dobra. */}
          <button
            type="button"
            onClick={() => setAberto((v) => !v)}
            aria-expanded={aberto}
            className="pressable mt-3 flex min-h-11 w-full items-center justify-between gap-2 rounded-xl bg-[var(--page)] px-3 text-xs font-semibold text-[var(--text-secondary)]"
          >
            {aberto ? 'ocultar cofrinhos' : `ver os ${data.pots.length} cofrinhos`}
            <IconChevron
              className={`h-4 w-4 transition-transform duration-200 ${aberto ? 'rotate-90' : ''}`}
            />
          </button>

          {aberto && (
            <ul className="mt-2 divide-y divide-[var(--border)]">
              {data.pots.map((pot) => {
                const pct =
                  pot.goal && pot.goal > 0 ? Math.min(1, pot.balance / pot.goal) : null

                return (
                  <li key={pot.categoryId} className="py-2.5">
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: catVar(pot.colorSlot) }}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">{pot.name}</span>
                      <span className="tabular shrink-0 text-sm font-semibold">
                        {formatBRL(pot.balance)}
                      </span>
                    </div>

                    {pct !== null && (
                      <div className="mt-1.5 flex items-center gap-2 pl-[1.125rem]">
                        <div
                          className="h-1.5 flex-1 overflow-hidden rounded-full"
                          style={{ background: 'color-mix(in srgb, var(--axis) 28%, transparent)' }}
                        >
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${pct * 100}%`,
                              background: catVar(pot.colorSlot),
                              transition: 'width var(--dur-slow) var(--ease-out)',
                            }}
                          />
                        </div>
                        <span className="tabular shrink-0 text-xs text-[var(--text-muted)]">
                          {Math.round(pct * 100)}% de {formatBRL(pot.goal as number)}
                        </span>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
