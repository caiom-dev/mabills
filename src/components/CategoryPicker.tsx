import { useState } from 'react'
import type { CategoryKind } from '@shared/types'
import { useCategories } from '@/lib/queries'
import { catVar } from '@/lib/theme'
import Sheet from './Sheet'
import CategoryForm from './CategoryForm'
import { IconPlus } from './Icons'

export default function CategoryPicker({
  value,
  onChange,
  kind,
}: {
  value: number | null
  onChange: (id: number | null) => void
  kind?: CategoryKind
}) {
  const { data: categories = [] } = useCategories()
  const [creating, setCreating] = useState(false)
  const visible = categories.filter(
    (category) => !category.isArchived && (!kind || category.kind === kind),
  )

  return (
    <div className="flex flex-wrap gap-2">
      {visible.map((category) => {
        const selected = category.id === value
        return (
          <button
            key={category.id}
            type="button"
            onClick={() => onChange(selected ? null : category.id)}
            aria-pressed={selected}
            className={`flex min-h-11 items-center gap-2 rounded-full px-3 text-sm transition-colors ${
              selected
                ? 'bg-[var(--text-primary)] text-[var(--surface)]'
                : 'bg-[var(--page)] text-[var(--text-secondary)] ring-1 ring-[var(--border)]'
            }`}
          >
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: catVar(category.colorSlot) }}
            />
            {category.name}
          </button>
        )
      })}

      {/*
        Criar sem sair do fluxo.
        É aqui que a falta de uma categoria realmente incomoda: com o lançamento
        na mão, pronto para classificar. Mandar o usuário até Ajustes significa
        perder o que estava fazendo e voltar para procurar de novo.
      */}
      <button
        type="button"
        onClick={() => setCreating(true)}
        className="pressable flex min-h-11 items-center gap-1.5 rounded-full border border-dashed border-[var(--axis)] px-3 text-sm text-[var(--text-secondary)]"
      >
        <IconPlus className="h-4 w-4" />
        Nova
      </button>

      <Sheet open={creating} onClose={() => setCreating(false)} title="Nova categoria">
        <CategoryForm
          autoFocus
          onCreated={(category) => {
            // Já deixa escolhida: era exatamente para isto que ela foi criada.
            onChange(category.id)
            setCreating(false)
          }}
        />
      </Sheet>
    </div>
  )
}
