import { formatBRL, formatBRLCompact } from '@shared/money'

type Size = 'sm' | 'md' | 'lg' | 'hero'
type Tone = 'auto' | 'neutral' | 'negative' | 'positive' | 'critical'

const SIZES: Record<Size, string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-2xl font-semibold',
  // Numero heroi: >= 48px e figuras PROPORCIONAIS. tabular-nums aqui deixaria
  // "121" com aparencia solta.
  hero: 'text-5xl font-semibold tracking-tight',
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
