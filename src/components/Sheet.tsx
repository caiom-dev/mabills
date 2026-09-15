import { useEffect, type ReactNode } from 'react'

/**
 * Painel que sobe pela base.
 *
 * Trava o scroll do body enquanto aberto: sem isso, arrastar dentro do painel
 * rola a pagina atras dele no iOS, que e o defeito mais comum de modal em PWA.
 */
export default function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return undefined

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div
        className="absolute inset-0 bg-black/45"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-2xl rounded-t-3xl bg-[var(--surface)] shadow-2xl"
        style={{
          animation: 'mabills-sheet-in 0.22s ease-out',
          paddingBottom: 'calc(1rem + var(--safe-bottom))',
          maxHeight: '90dvh',
        }}
      >
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex h-11 w-11 items-center justify-center rounded-full text-2xl leading-none text-[var(--text-muted)] active:opacity-60"
          >
            ×
          </button>
        </div>
        <div className="overflow-y-auto px-5 pb-2" style={{ maxHeight: 'calc(90dvh - 4rem)' }}>
          {children}
        </div>
      </div>
    </div>
  )
}
