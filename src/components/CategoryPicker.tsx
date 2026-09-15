import type { CategoryKind } from '@shared/types'
import { useCategories } from '@/lib/queries'
import { catVar } from '@/lib/theme'

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
    </div>
  )
}
