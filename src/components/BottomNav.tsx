import { Link, useLocation } from 'wouter'

const TABS = [
  { href: '/', label: 'Resumo' },
  { href: '/categorias', label: 'Categorias' },
  { href: '/transacoes', label: 'Lançamentos' },
  { href: '/ajustes', label: 'Ajustes' },
] as const

export default function BottomNav() {
  const [location] = useLocation()

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur"
      style={{ paddingBottom: 'var(--safe-bottom)' }}
      aria-label="Navegação principal"
    >
      <ul className="mx-auto flex max-w-2xl">
        {TABS.map((tab) => {
          const active = location === tab.href
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-1 text-xs ${
                  active
                    ? 'font-semibold text-[var(--cat-1)]'
                    : 'text-[var(--text-muted)]'
                }`}
              >
                {/* Barra fina no topo em vez de icone: o rotulo ja identifica a
                    aba, e o indicador nao depende so de cor. */}
                <span
                  aria-hidden="true"
                  className="h-0.5 w-6 rounded-full"
                  style={{ background: active ? 'var(--cat-1)' : 'transparent' }}
                />
                {tab.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
