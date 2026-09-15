/**
 * Inscricao do aparelho nas notificacoes.
 *
 * A parte que surpreende no iPhone: push NAO funciona no Safari com o site
 * aberto em aba. So funciona depois que o PWA foi adicionado a tela de inicio, e
 * ai `PushManager` sequer existe no `window` enquanto isso nao acontece. Por
 * isso "não suportado" e "falta instalar" sao estados diferentes aqui - dizer
 * "seu aparelho não suporta" para quem so precisa instalar o app seria mentira.
 */

import type { PushSubscriptionInput } from '@shared/types'

export type PushState =
  /** Navegador sem suporte a push (nenhuma acao resolve). */
  | 'unsupported'
  /** iPhone com o app aberto em aba: precisa ir para a tela de inicio antes. */
  | 'needs-install'
  /** Usuario negou a permissao. Só as Ajustes do iOS revertem. */
  | 'denied'
  /** Suportado e disponivel, mas este aparelho ainda nao esta inscrito. */
  | 'off'
  | 'on'

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

/** O PWA rodando fora do Safari: instalado na tela de inicio. */
function isStandalone(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true
}

export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export async function getPushState(): Promise<PushState> {
  if (!isPushSupported()) return isIos() && !isStandalone() ? 'needs-install' : 'unsupported'
  if (Notification.permission === 'denied') return 'denied'

  try {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    return subscription ? 'on' : 'off'
  } catch {
    return 'off'
  }
}

/**
 * A chave publica VAPID vai para o navegador como base64url, mas
 * `applicationServerKey` espera os bytes crus do ponto da curva.
 */
function toApplicationServerKey(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
  // O ArrayBuffer explicito e o que distingue Uint8Array<ArrayBuffer> de
  // Uint8Array<ArrayBufferLike>; so o primeiro satisfaz BufferSource.
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export class PushError extends Error {
  readonly state: PushState

  constructor(message: string, state: PushState) {
    super(message)
    this.name = 'PushError'
    this.state = state
  }
}

/**
 * Pede a permissao e inscreve o aparelho.
 *
 * Precisa ser chamada a partir de um toque do usuario: o iOS ignora
 * `requestPermission()` disparado fora de um gesto, sem erro nenhum.
 */
export async function enablePush(publicKey: string): Promise<PushSubscriptionInput> {
  if (!isPushSupported()) {
    throw new PushError(
      isIos() && !isStandalone()
        ? 'Adicione o app à tela de início antes de ativar as notificações.'
        : 'Este navegador não suporta notificações.',
      isIos() && !isStandalone() ? 'needs-install' : 'unsupported',
    )
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new PushError(
      'Permissão de notificação negada. Para reverter, vá em Ajustes do iPhone → MaBills → Notificações.',
      'denied',
    )
  }

  const registration = await navigator.serviceWorker.ready

  // Uma inscricao anterior pode ter sido feita com outra chave VAPID (par
  // regenerado no servidor). Nesse caso o subscribe falha, e a saida e cancelar
  // a antiga antes de tentar de novo.
  const existing = await registration.pushManager.getSubscription()
  if (existing) await existing.unsubscribe()

  const subscription = await registration.pushManager.subscribe({
    // Obrigatorio no iOS: todo push precisa virar notificacao visivel.
    userVisibleOnly: true,
    applicationServerKey: toApplicationServerKey(publicKey),
  })

  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new PushError('O navegador devolveu uma inscrição incompleta.', 'off')
  }

  return {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  }
}

/** Cancela no aparelho e devolve o endpoint, para o servidor apagar tambem. */
export async function disablePush(): Promise<string | null> {
  if (!isPushSupported()) return null

  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return null

  const { endpoint } = subscription
  await subscription.unsubscribe()
  return endpoint
}
