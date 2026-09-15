import { formatBRL, formatBRLCompact } from '@shared/money'

type Size = 'sm' | 'md' | 'lg' | 'hero'
type Tone = 'auto' | 'neutral' | 'negative' | 'positive' | 'critical'

const SIZES: Record<Size, string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-2xl font-semibold',
  // Numero heroi: .money-hero traz familia de display, tamanho fluido e o
  // tracking negativo que so faz sentido nesse corpo.
  hero: 'money-hero',
}

const TONES: Record<Tone, string> = {
  auto: 'text-[var(--text-primary)]',
  neutral: 'text-[var(--text-secondary)]',
  negative: 'text-[var(--text-primary)]',
  positive: 'text-[var(--success-text)]',
  critical: 'text-[var(--status-critical)]',
}

export default function Money({
  value,
  size = 'md',
  tone = 'auto',
  compact = false,
  className = '',
}: {
  value: number
  size?: Size
  tone?: Tone
  compact?: boolean
  className?: string
}) {
  const resolved: Tone = tone === 'auto' && value > 0 ? 'positive' : tone
  const text = compact ? formatBRLCompact(value) : formatBRL(value)
  // tabular so onde os numeros se alinham em coluna.
  const tabular = size === 'sm' || size === 'md' ? 'tabular' : ''

  return (
    <span className={`${SIZES[size]} ${TONES[resolved]} ${tabular} ${className}`}>{text}</span>
  )
}
