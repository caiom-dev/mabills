import type { ReactNode } from 'react'

export default function EmptyState({
  title,
  message,
  action,
}: {
  title: string
  message: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="text-base font-medium text-[var(--text-primary)]">{title}</p>
      <p className="max-w-xs text-sm text-[var(--text-secondary)]">{message}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}
