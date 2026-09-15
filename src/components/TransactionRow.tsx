import type { Transaction } from '@shared/types'
import { formatBRL } from '@shared/money'
import CategoryDot from './CategoryDot'

export default function TransactionRow({
  tx,
  onPress,
}: {
  tx: Transaction
  onPress?: (tx: Transaction) => void
}) {
  const isIncome = tx.amount > 0

  return (
    <button
      type="button"
      onClick={() => onPress?.(tx)}
      disabled={!onPress}
      className="flex min-h-11 w-full items-center gap-3 py-2.5 text-left active:opacity-70 disabled:active:opacity-100"
    >
      <CategoryDot slot={tx.categoryColorSlot} />

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-[var(--text-primary)]">{tx.description}</span>
        <span className="block truncate text-xs text-[var(--text-muted)]">
          {tx.categoryName ?? 'Sem categoria'}
          {tx.isIgnored && ' · fora do orçamento'}
          {tx.status === 'PENDING' && ' · pendente'}
        </span>
      </span>

      <span
        className={`shrink-0 text-sm tabular ${
          isIncome ? 'text-[var(--success-text)]' : 'text-[var(--text-primary)]'
        } ${tx.isIgnored ? 'line-through opacity-60' : ''}`}
      >
        {formatBRL(tx.amount)}
      </span>
    </button>
  )
}
