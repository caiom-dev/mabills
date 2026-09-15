export default function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`rounded-lg bg-[var(--gridline)] ${className}`}
      style={{ animation: 'mabills-pulse 1.6s ease-in-out infinite' }}
    />
  )
}
