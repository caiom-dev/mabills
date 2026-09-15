/**
 * Tokens de cor do MaBills.
 *
 * A paleta categorica NAO e escolha estetica: as duas versoes (clara e escura)
 * foram validadas por script contra faixa de luminosidade, piso de croma,
 * separacao sob daltonismo (protanopia/deuteranopia/tritanopia) e contraste
 * com a superficie. Resultado: todos os checks passam nos dois modos.
 *
 *   claro  - pior par adjacente sob CVD  DeltaE 9.1  (alvo >= 8)
 *   escuro - pior par adjacente sob CVD  DeltaE 8.4  (alvo >= 8)
 *
 * Por isso duas regras nao podem ser quebradas:
 *   1. Sao 8 slots. Um 9o matiz gerado e indistinguivel de outro sob CVD.
 *      Acima de 8, dobre a cauda em "Outros".
 *   2. A ORDEM dos slots e o mecanismo de seguranca, nao enfeite. Reordenar
 *      invalida a validacao.
 *
 * No modo claro, tres slots (aqua, amarelo, magenta) ficam abaixo de 3:1 de
 * contraste com a superficie. Isso e aceito porque toda visualizacao aqui tem
 * rotulo visivel ao lado da cor - a cor nunca carrega significado sozinha.
 */

export type ColorMode = 'light' | 'dark'

/** Os 8 slots categoricos, na ordem validada. Nao reordenar. */
export const CATEGORICAL: Record<ColorMode, readonly string[]> = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
} as const

/** Slot 0: categorias que nao competem por identidade (Outros, Transferencias). */
export const NEUTRAL: Record<ColorMode, string> = {
  light: '#898781',
  dark: '#898781',
}

/**
 * Cores de estado. Sao reservadas: nunca viram "serie 5", e nunca aparecem
 * sozinhas - sempre acompanhadas de rotulo ou icone.
 */
export const STATUS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
} as const

/** Cromo e tinta, por modo. */
export const CHROME: Record<ColorMode, Record<string, string>> = {
  light: {
    surface: '#fcfcfb',
    page: '#f9f9f7',
    textPrimary: '#0b0b0b',
    textSecondary: '#52514e',
    textMuted: '#898781',
    gridline: '#e1e0d9',
    axis: '#c3c2b7',
    successText: '#006300',
    border: 'rgba(11,11,11,0.10)',
  },
  dark: {
    surface: '#1a1a19',
    page: '#0d0d0d',
    textPrimary: '#ffffff',
    textSecondary: '#c3c2b7',
    textMuted: '#898781',
    gridline: '#2c2c2a',
    axis: '#383835',
    successText: '#0ca30c',
    border: 'rgba(255,255,255,0.10)',
  },
}

/**
 * Cor de uma categoria a partir do slot.
 * Slot 0 (ou invalido) devolve o neutro.
 */
export function slotColor(slot: number, mode: ColorMode = 'light'): string {
  if (!Number.isFinite(slot) || slot < 1 || slot > CATEGORICAL[mode].length) {
    return NEUTRAL[mode]
  }
  return CATEGORICAL[mode][slot - 1] ?? NEUTRAL[mode]
}

/** Quantidade maxima de fatias coloridas antes de dobrar a cauda em "Outros". */
export const MAX_CHART_SLICES = 6

/**
 * Cor de preenchimento do medidor de orcamento.
 *
 * O preenchimento carrega SEVERIDADE (estou estourando?), nao identidade -
 * a identidade da categoria fica no ponto colorido ao lado do nome. Sem isso,
 * uma tela com 8 medidores viraria oito cores brigando sem hierarquia.
 */
export function budgetStateColor(
  state: 'ok' | 'atencao' | 'estourado' | 'sem_orcamento',
  mode: ColorMode = 'light',
): string {
  switch (state) {
    case 'estourado':
      return STATUS.critical
    case 'atencao':
      return STATUS.warning
    case 'ok':
      return CATEGORICAL[mode][0] as string
    default:
      return NEUTRAL[mode]
  }
}
