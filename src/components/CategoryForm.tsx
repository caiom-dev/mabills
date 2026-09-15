import { useState } from 'react'
import type { Category, CategoryKind } from '@shared/types'
import { useCreateCategory } from '@/lib/queries'
import { catVar } from '@/lib/theme'

/**
 * Criação de categoria.
 *
 * Existe como componente próprio porque a mesma tarefa aparece em três
 * momentos diferentes: organizando a lista em Categorias, arrumando o app em
 * Ajustes, e — o mais frequente — no meio da categorização de um lançamento,
 * quando falta a categoria de que se precisa AGORA. Três cópias do formulário
 * divergiriam; já aconteceu neste projeto com a regra de "sem categoria".
 *
 * `onCreated` devolve a categoria recém-criada para quem chamou: é o que
 * permite ao seletor de categoria já deixá-la escolhida, em vez de obrigar o
 * usuário a procurá-la na lista depois.
 */

const KINDS: { value: CategoryKind; label: string; hint: string }[] = [
  { value: 'expense', label: 'Despesa', hint: 'entra no total gasto e aceita teto' },
  { value: 'income', label: 'Receita', hint: 'entra como entrada do mês' },
  { value: 'transfer', label: 'Transferência', hint: 'fica fora do total — nem gasto, nem renda' },
]

/** Os 8 slots validados, mais o neutro. */
const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 0]

export default function CategoryForm({
  onCreated,
  autoFocus = false,
}: {
  onCreated?: (category: Category) => void
  autoFocus?: boolean
}) {
  const create = useCreateCategory()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<CategoryKind>('expense')
  const [slot, setSlot] = useState(1)

  const trimmed = name.trim()
  const canSubmit = trimmed.length > 0 && !create.isPending

  function submit() {
    if (!canSubmit) return
    create.mutate(
      { name: trimmed, kind, colorSlot: slot },
      {
        onSuccess: (category) => {
          setName('')
          setKind('expense')
          setSlot(1)
          onCreated?.(category)
        },
      },
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="cat-name" className="mb-1.5 block text-xs font-semibold text-[var(--text-secondary)]">
          Nome
        </label>
        <input
          id="cat-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && submit()}
          autoFocus={autoFocus}
          maxLength={40}
          placeholder="Academia, Pet, Educação…"
          className="min-h-12 w-full rounded-xl bg-[var(--page)] px-4 text-base ring-1 ring-[var(--border)] outline-none focus:ring-2 focus:ring-[var(--cat-1)]"
        />
      </div>

      <div>
        <span className="mb-1.5 block text-xs font-semibold text-[var(--text-secondary)]">Tipo</span>
        {/* Três opções em vez da despesa fixa de antes. Sem isso não havia como
            criar uma categoria de transferência — que é justamente a que impede
            pagamento de fatura e aplicação de inflarem o total do mês. */}
        <div className="flex gap-1.5 rounded-xl bg-[var(--page)] p-1 ring-1 ring-[var(--border)]">
          {KINDS.map((option) => {
            const selected = kind === option.value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setKind(option.value)}
                aria-pressed={selected}
                className="pressable min-h-10 flex-1 rounded-lg text-xs font-semibold transition-colors"
                style={{
                  background: selected ? 'var(--surface)' : 'transparent',
                  color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
                  boxShadow: selected ? 'var(--shadow-sm)' : 'none',
                }}
              >
                {option.label}
              </button>
            )
          })}
        </div>
        <p className="mt-1.5 text-xs text-[var(--text-muted)]">
          {KINDS.find((k) => k.value === kind)?.hint}
        </p>
      </div>

      <div>
        <span className="mb-1.5 block text-xs font-semibold text-[var(--text-secondary)]">Cor</span>
        {/* Só os slots validados. Um 9º matiz gerado seria indistinguível dos
            existentes sob daltonismo — a paleta é verificada por script. */}
        <div className="flex flex-wrap gap-2">
          {SLOTS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setSlot(option)}
              aria-label={option === 0 ? 'Cinza neutro' : `Cor ${option}`}
              aria-pressed={slot === option}
              className="pressable h-10 w-10 rounded-full transition-transform"
              style={{
                background: catVar(option),
                outline: slot === option ? '2px solid var(--text-primary)' : 'none',
                outlineOffset: '2px',
              }}
            />
          ))}
        </div>
      </div>

      {/* Prévia: mostra exatamente como a categoria vai aparecer nas listas.
          Barato de construir e evita a descoberta tardia de que o nome ficou
          grande demais ou a cor não combina com as vizinhas. */}
      {trimmed && (
        <div className="flex items-center gap-2 rounded-xl bg-[var(--page)] px-4 py-3">
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: catVar(slot) }}
          />
          <span className="truncate text-sm font-medium">{trimmed}</span>
          <span className="ml-auto shrink-0 text-xs text-[var(--text-muted)]">prévia</span>
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit}
        className="pressable min-h-12 w-full rounded-xl bg-[var(--cat-1)] text-sm font-semibold text-white disabled:opacity-45"
      >
        {create.isPending ? 'Criando…' : 'Criar categoria'}
      </button>

      {create.error && (
        <p role="alert" className="text-sm text-[var(--status-critical)]">
          {create.error.message}
        </p>
      )}
    </div>
  )
}
