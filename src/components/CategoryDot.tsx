import { catVar } from '@/lib/theme'

/**
 * Ponto de identidade da categoria.
 *
 * A cor da categoria vive AQUI, ao lado do nome - e nunca no texto nem no
 * preenchimento do medidor. Amarelo e aqua sao ilegiveis como texto, e o
 * preenchimento do medidor precisa carregar severidade, nao identidade.
 */
export default function CategoryDot({
  slot,
  size = 10,
  className = '',
}: {
  slot: number | null | undefined
  size?: number
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 rounded-full ${className}`}
      style={{ width: size, height: size, background: catVar(slot) }}
    />
  )
}
