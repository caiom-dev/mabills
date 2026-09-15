import { Component, useEffect, useState, type ReactNode } from 'react'
import { Route, Switch } from 'wouter'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from './lib/queries'
import { ApiError } from './lib/api'
import BottomNav from './components/BottomNav'
import Summary from './pages/Summary'
import Categories from './pages/Categories'
import Transactions from './pages/Transactions'
import Budgets from './pages/Budgets'
import Settings from './pages/Settings'
import Login from './pages/Login'

/**
 * Um erro em qualquer tela nao pode virar tela branca: num app instalado o
 * usuario nao tem barra de endereco para recarregar.
 */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="text-lg font-semibold">Algo deu errado</h1>
        <p className="max-w-sm text-sm text-[var(--text-secondary)]">
          {this.state.error.message || 'Erro inesperado ao carregar a tela.'}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="min-h-11 rounded-xl bg-[var(--cat-1)] px-5 text-sm font-medium text-white"
        >
          Recarregar
        </button>
      </div>
    )
  }
}

/** Faixa discreta de offline. Sem ela o usuario acha que o dado esta atual. */
function OfflineBanner() {
  const [offline, setOffline] = useState(() => !navigator.onLine)

  useEffect(() => {
    const goOnline = () => setOffline(false)
    const goOffline = () => setOffline(true)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  if (!offline) return null
  return (
    <div
      role="status"
      className="sticky top-0 z-40 bg-[var(--status-warning)] px-4 py-1.5 text-center text-xs font-medium text-[#0b0b0b]"
    >
      Sem conexão — mostrando os últimos dados salvos
    </div>
  )
}

export default function App() {
  const { data, isLoading } = useAuth()
  const client = useQueryClient()

  /**
   * Expiracao de sessao no meio do uso.
   *
   * A API responde 401 JSON (nunca redirect), entao basta escutar o cache de
   * queries: qualquer erro 401 derruba o estado de autenticado e a tela de PIN
   * aparece por cima, dentro do proprio PWA.
   */
  useEffect(() => {
    const unsubscribe = client.getQueryCache().subscribe((event) => {
      const error = event.query.state.error
      if (error instanceof ApiError && error.isUnauthenticated) {
        client.setQueryData(['auth'], { authenticated: false })
      }
    })
    return unsubscribe
  }, [client])

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div
          className="h-8 w-8 rounded-full border-2 border-[var(--gridline)] border-t-[var(--cat-1)]"
          style={{ animation: 'spin 0.8s linear infinite' }}
          aria-label="Carregando"
        />
        <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
      </div>
    )
  }

  if (!data?.authenticated) return <Login />

  return (
    <ErrorBoundary>
      <OfflineBanner />
      {/* O padding inferior reserva espaco para a barra fixa + area segura do
          iPhone; sem ele o ultimo item da lista fica escondido atras da nav. */}
      <main
        className="mx-auto w-full max-w-2xl px-4 pt-4"
        style={{ paddingBottom: 'calc(5.5rem + var(--safe-bottom))' }}
      >
        <Switch>
          <Route path="/" component={Summary} />
          <Route path="/categorias" component={Categories} />
          <Route path="/transacoes" component={Transactions} />
          <Route path="/orcamentos" component={Budgets} />
          <Route path="/ajustes" component={Settings} />
          <Route>
            <div className="py-20 text-center text-sm text-[var(--text-secondary)]">
              Página não encontrada.
            </div>
          </Route>
        </Switch>
      </main>
      <BottomNav />
    </ErrorBoundary>
  )
}
