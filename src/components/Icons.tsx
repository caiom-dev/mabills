/**
 * Ícones do app.
 *
 * São SVG escritos à mão, não uma biblioteca. Três motivos:
 *
 *  1. Peso. Lucide como dependência custaria ~30 KB para os nove ícones que
 *     este app usa — num projeto cujo orçamento inteiro é "custar R$ 0" e abrir
 *     offline no 4G do metrô.
 *  2. Animação. Um ícone de biblioteca é um bloco fechado; aqui cada traço tem
 *     nome e pode ser animado sozinho — o ponteiro do medidor varre, os
 *     segmentos da rosca entram em sequência.
 *  3. Coerência. Um único grid (24px), uma única espessura (1.75), um único
 *     raio de junta. Ícone misturado de fontes diferentes é o detalhe que faz
 *     um app parecer montado às pressas.
 *
 * Todos herdam `currentColor` — a cor é decidida por quem usa, nunca aqui.
 */

interface IconProps {
  className?: string
  /**
   * Dispara a animação de entrada do traço. Na barra inferior, é o que faz o
   * ícone da aba escolhida se desenhar em vez de simplesmente trocar de cor.
   */
  active?: boolean
}

const base = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

/**
 * `key` muda junto com `active` para forçar o React a remontar o nó.
 * Sem isso a animação só rodaria na primeira vez: o CSS não reinicia um
 * keyframe já concluído se a classe apenas volta a ser aplicada.
 */
const animKey = (active?: boolean) => (active ? 'on' : 'off')

// ---------------------------------------------------------------------------
// Navegação
// ---------------------------------------------------------------------------

/** Resumo. O telhado desenha, depois a porta sobe do piso. */
export function IconHome({ className, active }: IconProps) {
  return (
    <svg {...base} className={className}>
      <g key={animKey(active)} className={active ? 'ico-draw' : undefined}>
        <path d="M3.5 10.5 12 3.5l8.5 7" />
        <path d="M5.5 9.8V19a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5V9.8" />
      </g>
      <path
        key={`door-${animKey(active)}`}
        className={active ? 'ico-door' : undefined}
        d="M9.75 20.5v-4.75a2.25 2.25 0 0 1 4.5 0v4.75"
      />
    </svg>
  )
}

/**
 * Categorias. Três arcos de uma rosca, entrando em sequência — a mesma leitura
 * do gráfico de composição que a tela mostra logo abaixo.
 */
export function IconDonut({ className, active }: IconProps) {
  return (
    <svg {...base} className={className}>
      <g key={animKey(active)} className={active ? 'ico-spin' : undefined}>
        {/* pathLength=100 normaliza o traço: os dasharray abaixo viram
            porcentagem da volta, independente do raio real. */}
        <circle cx="12" cy="12" r="8" pathLength={100} strokeDasharray="44 56" />
        <circle
          cx="12"
          cy="12"
          r="8"
          pathLength={100}
          strokeDasharray="28 72"
          strokeDashoffset="-48"
          opacity="0.55"
        />
        <circle
          cx="12"
          cy="12"
          r="8"
          pathLength={100}
          strokeDasharray="20 80"
          strokeDashoffset="-78"
          opacity="0.3"
        />
      </g>
    </svg>
  )
}

/** Transações. As duas setas deslizam em sentidos opostos: entra e sai. */
export function IconExchange({ className, active }: IconProps) {
  return (
    <svg {...base} className={className}>
      <g key={`up-${animKey(active)}`} className={active ? 'ico-slide-r' : undefined}>
        <path d="M4 8.5h13" />
        <path d="M14 5.5 17 8.5l-3 3" />
      </g>
      <g key={`dn-${animKey(active)}`} className={active ? 'ico-slide-l' : undefined}>
        <path d="M20 15.5H7" />
        <path d="M10 12.5 7 15.5l3 3" />
      </g>
    </svg>
  )
}

/** Orçamentos. O ponteiro varre do mínimo até a posição de repouso. */
export function IconGauge({ className, active }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M3.5 17.5a8.5 8.5 0 0 1 17 0" pathLength={100} />
      <g
        key={animKey(active)}
        className={active ? 'ico-sweep' : undefined}
        style={{ transformOrigin: '12px 17.5px' }}
      >
        <path d="M12 17.5 16 13" />
      </g>
      <circle cx="12" cy="17.5" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Ajustes. Os cursores correm até a posição. */
export function IconSliders({ className, active }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 8h16" />
      <path d="M4 16h16" />
      <g key={animKey(active)} className={active ? 'ico-settle' : undefined}>
        <circle cx="15" cy="8" r="2.6" fill="var(--surface)" />
        <circle cx="9" cy="16" r="2.6" fill="var(--surface)" />
      </g>
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------------

export function IconPlus({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function IconUpload({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 16V4" />
      <path d="m8 8 4-4 4 4" />
      <path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" />
    </svg>
  )
}

/** A seta gira enquanto `spinning` — o estado de sincronização em andamento. */
export function IconSync({ className, spinning }: IconProps & { spinning?: boolean }) {
  return (
    <svg {...base} className={`${className ?? ''} ${spinning ? 'ico-rotate' : ''}`.trim()}>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 3.5V9h-5.5" />
    </svg>
  )
}

export function IconChevron({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="m9 5 7 7-7 7" />
    </svg>
  )
}

/** Alerta de categoria estourando. */
export function IconAlert({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 8.5v4.5" />
      <circle cx="12" cy="16.5" r="0.9" fill="currentColor" stroke="none" />
      <path d="M10.3 3.9 2.6 17.4A1.6 1.6 0 0 0 4 19.8h16a1.6 1.6 0 0 0 1.4-2.4L13.7 3.9a1.6 1.6 0 0 0-2.8 0Z" />
    </svg>
  )
}

/** Seta de variação, usada nos indicadores de ritmo. */
export function IconTrend({ className, down }: IconProps & { down?: boolean }) {
  return (
    <svg {...base} className={className}>
      {down ? (
        <>
          <path d="M3.5 7.5 10 14l3.5-3.5L20.5 17" />
          <path d="M20.5 12.5V17h-4.5" />
        </>
      ) : (
        <>
          <path d="M3.5 16.5 10 10l3.5 3.5L20.5 7" />
          <path d="M20.5 11.5V7H16" />
        </>
      )}
    </svg>
  )
}
