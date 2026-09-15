import type { ReactNode } from 'react'

export default function Card({
  children,
  className = '',
  title,
  action,
}: {
  children: ReactNode
  className?: string
  title?: string
  action?: ReactNode
}) {
  return (
    <section
      className={`rounded-2xl bg-[var(--surface)] p-4 ring-1 ring-[var(--border)] ${className}`}
    >
      {(title || action) && (
        <header className="mb-3 flex items-center justify-between gap-3">
          {title && (
            <h2 className="text-sm font-semibold text-[var(--text-secondary)]">{title}</h2>
          )}
          {action}
        </header>
      )}
      {children}
    </section>
  )
}
