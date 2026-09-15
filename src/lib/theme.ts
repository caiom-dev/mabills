import { useEffect, useState } from 'react'
import type { ColorMode } from '@shared/palette'

/**
 * Modo de cor atual.
 *
 * O CSS ja troca os tokens sozinho; este hook existe para o punhado de lugares
 * que precisam da cor em JavaScript (calculo de contraste de rotulo dentro de
 * uma barra, por exemplo), onde ler var(--...) nao serve.
 */
export function useColorMode(): ColorMode {
  const [mode, setMode] = useState<ColorMode>(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light',
  )

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const handle = (event: MediaQueryListEvent) => setMode(event.matches ? 'dark' : 'light')
    query.addEventListener('change', handle)
    return () => query.removeEventListener('change', handle)
  }, [])

  return mode
}

/** Cor de uma categoria pelo slot, via CSS custom property. */
export function catVar(slot: number | null | undefined): string {
  const index = typeof slot === 'number' && slot >= 1 && slot <= 8 ? slot : 0
  return `var(--cat-${index})`
}
