import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { get, set } from 'idb-keyval'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { ApiError } from './lib/api'
import './index.css'

const CACHE_KEY = 'mabills-query-cache'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 7 * 24 * 60 * 60 * 1000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        // Re-tentar um 401 so gera ruido: a sessao nao volta sozinha.
        if (error instanceof ApiError && (error.status === 401 || error.status === 429)) return false
        return failureCount < 1
      },
    },
    mutations: { retry: false },
  },
})

/**
 * Persistencia offline.
 *
 * Um dump do cache em IndexedDB, sem a biblioteca oficial de persistencia. O
 * ganho pratico e o app abrir mostrando os ultimos numeros conhecidos em vez de
 * esqueleto quando o iPhone esta sem rede.
 *
 * Toda a operacao e best-effort: falha em ler ou gravar NUNCA pode impedir o app
 * de abrir, por isso os try/catch silenciosos.
 */
interface CachedEntry {
  key: unknown
  data: unknown
}

async function restoreCache(): Promise<void> {
  try {
    const saved = await get<CachedEntry[]>(CACHE_KEY)
    if (!Array.isArray(saved)) return
    for (const entry of saved) {
      if (entry?.key !== undefined && entry.data !== undefined) {
        queryClient.setQueryData(entry.key as readonly unknown[], entry.data as never)
      }
    }
  } catch {
    /* cache corrompido ou IndexedDB indisponivel */
  }
}

function persistCache(): void {
  try {
    const entries: CachedEntry[] = queryClient
      .getQueryCache()
      .getAll()
      .filter((query) => query.state.status === 'success')
      .map((query) => ({ key: query.queryKey, data: query.state.data }))
    void set(CACHE_KEY, entries).catch(() => undefined)
  } catch {
    /* idem */
  }
}

// Grava ao sair e quando o app vai para segundo plano. No iOS o
// 'visibilitychange' e mais confiavel que 'beforeunload', que muitas vezes nem
// dispara quando o usuario troca de app.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persistCache()
})
window.addEventListener('pagehide', persistCache)

registerSW({ immediate: true })

const container = document.getElementById('root')
if (!container) throw new Error('Elemento #root nao encontrado.')

void restoreCache().finally(() => {
  createRoot(container).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  )
})
