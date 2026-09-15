import { Link, useLocation } from 'wouter'
import { IconDonut, IconExchange, IconGauge, IconHome, IconSliders } from './Icons'

/**
 * Barra de abas.
 *
 * Cinco abas é o teto do padrão iOS, e Orçamentos entrou porque a rota já
 * existia sem porta de entrada — só se chegava nela por um link solto da tela
 * inicial, o que escondia metade do produto.
 *
 * O indicador de aba ativa é redundante de propósito: cor, peso da fonte E a
 * pílula atrás do ícone. Só a cor excluiria quem não a distingue.
 */
const TABS = [
  { href: '/', label: 'Resumo', Icon: IconHome },
  { href: '/categorias', label: 'Categorias', Icon: IconDonut },
  { href: '/transacoes', label: 'Lançamentos', Icon: IconExchange },
  { href: '/orcamentos', label: 'Orçamentos', Icon: IconGauge },
  { href: '/ajustes', label: 'Ajustes', Icon: IconSliders },
] as const

export default function BottomNav() {
  const [location] = useLocation()

  return (
    <nav
      /*
       * A barra flutua sobre o conteúdo com desfoque. O fundo semitransparente
       * deixa entrever o que está atrás ao rolar — a pista de que a lista
       * continua, em vez de uma faixa sólida que parece o fim da página.
       */
      className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_88%,transparent)] backdrop-blur-xl"
      style={{ paddingBottom: 'var(--safe-bottom)' }}
      aria-label="Navegação principal"
    >
      <ul className="mx-auto flex max-w-2xl px-1">
        {TABS.map(({ href, label, Icon }) => {
          const active = location === href

          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className="pressable flex min-h-14 flex-col items-center justify-center gap-1 py-2"
              >
                <span
                  className="relative flex h-8 w-12 items-center justify-center rounded-full transition-colors duration-200"
                  style={{
                    background: active
                      ? 'color-mix(in srgb, var(--cat-1) 14%, transparent)'
                      : 'transparent',
                    color: active ? 'var(--cat-1)' : 'var(--text-muted)',
                  }}
                >
                  <Icon className="h-[22px] w-[22px]" active={active} />
                </span>
                <span
                  className="text-[0.625rem] leading-none transition-colors duration-200"
                  style={{
                    color: active ? 'var(--cat-1)' : 'var(--text-muted)',
                    fontWeight: active ? 600 : 500,
                  }}
                >
                  {label}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
