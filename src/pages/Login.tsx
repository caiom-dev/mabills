import { useState, type FormEvent } from 'react'
import { useLogin } from '@/lib/queries'
import { ApiError } from '@/lib/api'

export default function Login() {
  const [pin, setPin] = useState('')
  const login = useLogin()

  const error = login.error
  let message: string | null = null
  if (error instanceof ApiError) {
    if (error.status === 429 && error.retryAfterSeconds) {
      const minutes = Math.max(1, Math.ceil(error.retryAfterSeconds / 60))
      message = `Muitas tentativas. Tente novamente em ${minutes} ${
        minutes === 1 ? 'minuto' : 'minutos'
      }.`
    } else if (error.status === 401) {
      // Nao dizemos quantas tentativas restam: isso so ajudaria quem chuta.
      message = 'PIN incorreto.'
    } else {
      message = error.message
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!pin || login.isPending) return
    login.mutate(pin)
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-2xl bg-[var(--surface)] p-6 ring-1 ring-[var(--border)]"
      >
        <h1 className="text-xl font-semibold">MaBills</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Digite seu PIN para acessar.
        </p>

        <input
          type="password"
          value={pin}
          onChange={(event) => setPin(event.target.value)}
          // inputMode numeric abre o teclado numerico, mas o campo aceita texto:
          // o PIN pode ser uma frase, que tem muito mais entropia.
          inputMode="numeric"
          autoComplete="current-password"
          autoFocus
          aria-label="PIN"
          placeholder="••••••"
          className="mt-5 min-h-12 w-full rounded-xl bg-[var(--page)] px-4 text-center text-lg tracking-widest ring-1 ring-[var(--border)] outline-none focus:ring-2 focus:ring-[var(--cat-1)]"
        />

        {message && (
          <p role="alert" className="mt-3 text-sm text-[var(--status-critical)]">
            {message}
          </p>
        )}

        <button
          type="submit"
          disabled={!pin || login.isPending}
          className="mt-5 min-h-12 w-full rounded-xl bg-[var(--cat-1)] text-sm font-medium text-white disabled:opacity-45"
        >
          {login.isPending ? 'Verificando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}
