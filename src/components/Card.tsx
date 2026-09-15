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
    /* Raio de 20px: acompanha o cartao heroi (24px) sem imita-lo. A diferenca
       de curvatura e parte do que marca qual dos dois e o principal. */
    <section
      className={`rounded-[1.25rem] bg-[var(--surface)] p-4 ring-1 ring-[var(--border)] ${className}`}
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      {(title || action) && (
        <header className="mb-3 flex items-center justify-between gap-3">
          {title && (
            <h2 className="display-sm text-[0.9375rem] text-[var(--text-primary)]">{title}</h2>
          )}
          {action}
        </header>
      )}
      {children}
    </section>
  )
}
