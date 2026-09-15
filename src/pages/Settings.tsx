import { useState, type ChangeEvent } from 'react'
import type { ImportPreview } from '@shared/types'
import { currentMonth, formatDateShort, formatRelative } from '@shared/dates'
import { formatBRL } from '@shared/money'
import { api } from '@/lib/api'
import {
  useCategories,
  useDeleteCategory,
  useDeleteRule,
  useDisablePush,
  useEnablePush,
  useLogout,
  usePushDevice,
  usePushStatus,
  useRunSync,
  useRules,
  useSyncStatus,
  useTestPush,
} from '@/lib/queries'
import { useQueryClient } from '@tanstack/react-query'
import Card from '@/components/Card'
import CategoryDot from '@/components/CategoryDot'
import CategoryForm from '@/components/CategoryForm'
import Skeleton from '@/components/Skeleton'

export default function Settings() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Ajustes</h1>
      <SyncSection />
      <NotificationsSection />
      <ImportSection />
      <RulesSection />
      <CategoriesSection />
      <DataSection />
    </div>
  )
}

// ---------------------------------------------------------------------------

function SyncSection() {
  const status = useSyncStatus()
  const sync = useRunSync()

  if (status.isLoading) return <Skeleton className="h-32 w-full" />

  const data = status.data

  return (
    <Card title="Conexão bancária">
      {/* Um item em LOGIN_ERROR faz o sync parar em silencio. Sem este aviso o
          usuario continuaria confiando em dados que pararam de chegar. */}
      {data?.itemIssues.map((issue) => (
        <div
          key={issue.itemId}
          className="mb-3 rounded-xl bg-[color-mix(in_srgb,var(--status-critical)_12%,transparent)] p-3 text-sm"
        >
          <p className="font-medium text-[var(--status-critical)]">Sincronização parada</p>
          <p className="mt-1 text-[var(--text-secondary)]">{issue.message}</p>
          <a
            href="https://meu.pluggy.ai"
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex min-h-11 items-center text-[var(--cat-1)]"
          >
            Reconectar em meu.pluggy.ai →
          </a>
        </div>
      ))}

      {!data?.configured ? (
        <p className="text-sm text-[var(--text-secondary)]">
          A integração com o banco não está configurada. O app funciona normalmente com importação
          de extrato e lançamento manual — veja o README para conectar via Pluggy.
        </p>
      ) : (
        <>
          <ul className="mb-3 divide-y divide-[var(--border)]">
            {data.accounts.map((account) => (
              <li key={account.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm">{account.name}</span>
                  <span className="block text-xs text-[var(--text-muted)]">
                    {account.type === 'CREDIT' ? 'cartão de crédito' : 'conta'}
                  </span>
                </span>
                {account.balance !== null && (
                  <span className="shrink-0 text-sm tabular">{formatBRL(account.balance)}</span>
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs text-[var(--text-muted)]">
            última sincronização {formatRelative(data.lastSyncAt)}
          </p>
        </>
      )}

      <button
        type="button"
        onClick={() => sync.mutate(false)}
        disabled={sync.isPending}
        className="mt-3 min-h-11 w-full rounded-xl bg-[var(--page)] text-sm ring-1 ring-[var(--border)] disabled:opacity-50"
      >
        {sync.isPending ? 'Sincronizando…' : 'Sincronizar agora'}
      </button>

      {sync.data && (
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          {sync.data.inserted} novos · {sync.data.updated} atualizados
          {sync.data.errors.length > 0 && (
            <span className="mt-1 block text-xs text-[var(--status-critical)]">
              {sync.data.errors.join(' · ')}
            </span>
          )}
        </p>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------

/**
 * Notificacoes.
 *
 * A tela precisa separar tres "desligados" que exigem acoes diferentes do
 * usuario: o servidor sem chaves VAPID, o app ainda nao instalado na tela de
 * inicio (no iPhone push so existe depois disso) e a permissao negada, que so
 * volta pelos Ajustes do iOS. Um unico "notificacoes indisponiveis" mandaria o
 * usuario procurar defeito no lugar errado.
 */
function NotificationsSection() {
  const status = usePushStatus()
  const device = usePushDevice()
  const enable = useEnablePush()
  const disable = useDisablePush()
  const test = useTestPush()

  if (status.isLoading || device.isLoading) return <Skeleton className="h-32 w-full" />

  const publicKey = status.data?.publicKey
  const state = device.data ?? 'off'
  const failure = enable.error ?? disable.error

  return (
    <Card title="Alertas de gasto">
      <p className="text-sm text-[var(--text-secondary)]">
        Um aviso quando uma categoria passa de 80% do teto, e outro se ela estourar. No máximo dois
        por categoria a cada mês.
      </p>

      {!status.data?.configured ? (
        <p className="mt-3 text-sm text-[var(--text-muted)]">
          As notificações não estão configuradas neste servidor. Gere o par de chaves com{' '}
          <code className="rounded bg-[var(--page)] px-1">npm run vapid</code> e grave os dois
          segredos — o README tem o passo a passo.
        </p>
      ) : state === 'needs-install' ? (
        <p className="mt-3 text-sm text-[var(--text-muted)]">
          No iPhone, as notificações só funcionam com o app na tela de início. Toque em
          Compartilhar → Adicionar à Tela de Início, abra por lá e volte aqui.
        </p>
      ) : state === 'unsupported' ? (
        <p className="mt-3 text-sm text-[var(--text-muted)]">
          Este navegador não suporta notificações. No iPhone, use o Safari e instale o app na tela
          de início.
        </p>
      ) : state === 'denied' ? (
        <p className="mt-3 text-sm text-[var(--text-muted)]">
          A permissão foi negada neste aparelho. Para reverter: Ajustes do iPhone → MaBills →
          Notificações.
        </p>
      ) : state === 'on' ? (
        <>
          <p className="mt-3 text-sm">
            Ativadas neste aparelho
            {(status.data?.devices ?? 0) > 1 && ` · ${status.data?.devices} aparelhos no total`}
          </p>
          <button
            type="button"
            onClick={() => test.mutate()}
            disabled={test.isPending}
            className="mt-3 min-h-11 w-full rounded-xl bg-[var(--page)] text-sm ring-1 ring-[var(--border)] disabled:opacity-50"
          >
            {test.isPending ? 'Enviando…' : 'Enviar notificação de teste'}
          </button>
          {test.data && (
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              {test.data.sent > 0
                ? `Enviada para ${test.data.sent} aparelho(s).`
                : 'Nenhum aparelho recebeu. Tente ativar de novo neste iPhone.'}
            </p>
          )}
          <button
            type="button"
            onClick={() => disable.mutate()}
            disabled={disable.isPending}
            className="mt-2 min-h-11 w-full rounded-xl text-sm text-[var(--status-critical)] ring-1 ring-[var(--border)] disabled:opacity-50"
          >
            {disable.isPending ? 'Desativando…' : 'Desativar neste aparelho'}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => publicKey && enable.mutate(publicKey)}
          disabled={enable.isPending || !publicKey}
          className="mt-3 min-h-11 w-full rounded-xl bg-[var(--page)] text-sm ring-1 ring-[var(--border)] disabled:opacity-50"
        >
          {enable.isPending ? 'Ativando…' : 'Ativar notificações'}
        </button>
      )}

      {failure && (
        <p className="mt-2 text-sm text-[var(--status-critical)]">{failure.message}</p>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------

function ImportSection() {
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const client = useQueryClient()

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const content = await file.text()
      setPreview(await api.importPreview(file.name, content))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao ler o arquivo.')
    } finally {
      setBusy(false)
      event.target.value = ''
    }
  }

  async function commit() {
    if (!preview) return
    setBusy(true)
    try {
      const result = await api.importCommit(preview.token)
      setDone(`${result.inserted} lançamentos importados.`)
      setPreview(null)
      await client.invalidateQueries()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao importar.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Importar extrato">
      <p className="mb-3 text-sm text-[var(--text-secondary)]">
        No app do banco, exporte o extrato em <strong>OFX</strong> — é o formato mais confiável,
        porque traz um identificador por transação e reimportar o mesmo arquivo nunca duplica.
        CSV também funciona.
      </p>

      <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl bg-[var(--page)] text-sm ring-1 ring-[var(--border)]">
        {busy ? 'Processando…' : 'Escolher arquivo'}
        <input
          type="file"
          accept=".ofx,.qfx,.csv,.txt"
          onChange={onFile}
          disabled={busy}
          className="hidden"
        />
      </label>

      {error && <p className="mt-3 text-sm text-[var(--status-critical)]">{error}</p>}
      {done && <p className="mt-3 text-sm text-[var(--success-text)]">{done}</p>}

      {/* Preview obrigatorio: importar extrato e a operacao que o usuario mais
          teme duplicar. Ver a contagem antes torna seguro repetir. */}
      {preview && (
        <div className="mt-4">
          <p className="text-sm">
            <strong>{preview.newCount}</strong> novos ·{' '}
            <span className="text-[var(--text-muted)]">
              {preview.duplicateCount} já existentes (serão ignorados)
            </span>
          </p>
          {preview.dateRange && (
            <p className="text-xs text-[var(--text-muted)]">
              período: {formatDateShort(preview.dateRange.from)} a{' '}
              {formatDateShort(preview.dateRange.to)}
            </p>
          )}

          <ul className="mt-3 max-h-64 divide-y divide-[var(--border)] overflow-y-auto">
            {preview.rows.slice(0, 60).map((row, index) => (
              <li
                key={`${row.externalId ?? index}`}
                className={`flex items-center justify-between gap-3 py-2 text-sm ${
                  row.duplicate ? 'opacity-40' : ''
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate">{row.description}</span>
                  <span className="block text-xs text-[var(--text-muted)]">
                    {formatDateShort(row.date)} · {row.suggestedCategoryName ?? 'sem categoria'}
                    {row.duplicate && ' · duplicado'}
                  </span>
                </span>
                <span className="shrink-0 tabular">{formatBRL(row.amount)}</span>
              </li>
            ))}
          </ul>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={commit}
              disabled={busy || preview.newCount === 0}
              className="min-h-11 flex-1 rounded-xl bg-[var(--cat-1)] text-sm font-medium text-white disabled:opacity-45"
            >
              Importar {preview.newCount}
            </button>
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="min-h-11 rounded-xl px-4 text-sm ring-1 ring-[var(--border)]"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------

function RulesSection() {
  const rules = useRules()
  const remove = useDeleteRule()

  return (
    <Card title="Regras de categorização">
      <p className="mb-3 text-sm text-[var(--text-secondary)]">
        O jeito mais fácil de criar uma regra é trocar a categoria de um lançamento e marcar
        “aplicar a todos os lançamentos parecidos”.
      </p>

      {rules.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <ul className="max-h-72 divide-y divide-[var(--border)] overflow-y-auto">
          {(rules.data ?? []).map((rule) => (
            <li key={rule.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate text-sm">{rule.pattern}</span>
                <span className="block text-xs text-[var(--text-muted)]">
                  {rule.categoryName} · {rule.hitCount}×
                </span>
              </span>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Apagar a regra “${rule.pattern}”?`)) remove.mutate(rule.id)
                }}
                aria-label={`Apagar regra ${rule.pattern}`}
                className="min-h-11 shrink-0 px-3 text-sm text-[var(--status-critical)]"
              >
                remover
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------

function CategoriesSection() {
  const categories = useCategories()
  const remove = useDeleteCategory()

  return (
    <Card title="Categorias">
      <ul className="mb-3 divide-y divide-[var(--border)]">
        {(categories.data ?? []).map((category) => (
          <li key={category.id} className="flex items-center justify-between gap-3 py-2">
            <span className="flex min-w-0 items-center gap-2">
              <CategoryDot slot={category.colorSlot} />
              <span className="truncate text-sm">{category.name}</span>
            </span>
            {category.isSystem ? (
              <span className="shrink-0 text-xs text-[var(--text-muted)]">padrão do app</span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Apagar a categoria “${category.name}”?`)) remove.mutate(category.id)
                }}
                className="min-h-11 shrink-0 px-3 text-sm text-[var(--status-critical)]"
              >
                remover
              </button>
            )}
          </li>
        ))}
      </ul>

      {/* Mesmo formulário da tela Categorias e do seletor de lançamento.
          A versão que vivia aqui só criava despesa — não havia como criar uma
          categoria de transferência pelo app. */}
      <div className="rounded-xl bg-[var(--page)] p-3">
        <CategoryForm />
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------

function DataSection() {
  const logout = useLogout()
  const month = currentMonth()

  return (
    <Card title="Dados">
      <a
        href={api.exportUrl(month)}
        className="flex min-h-11 items-center justify-center rounded-xl bg-[var(--page)] text-sm ring-1 ring-[var(--border)]"
      >
        Exportar CSV do mês
      </a>
      <button
        type="button"
        onClick={() => logout.mutate()}
        className="mt-2 min-h-11 w-full rounded-xl text-sm text-[var(--status-critical)] ring-1 ring-[var(--border)]"
      >
        Sair
      </button>
    </Card>
  )
}
