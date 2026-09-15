/**
 * Handlers de push do service worker.
 *
 * Este arquivo e importado pelo service worker que o Workbox gera (veja
 * `workbox.importScripts` no vite.config.ts). Ele fica separado porque o modo
 * generateSW nao aceita codigo proprio dentro do arquivo gerado, e trocar para
 * injectManifest so por causa de dois listeners custaria reescrever a
 * estrategia de cache inteira na mao.
 *
 * O payload chega CIFRADO e ja decifrado pelo navegador (RFC 8291), entao o
 * texto vem pronto aqui dentro - nao ha fetch para a API no meio do caminho.
 * Isso importa: a notificacao precisa funcionar com a sessao expirada e com o
 * iPhone acordando sem rede boa.
 */

/* global self, clients */

self.addEventListener('push', (event) => {
  const fallback = {
    title: 'MaBills',
    body: 'Há uma novidade no seu orçamento.',
    url: '/',
    tag: 'mabills',
  }

  let data = fallback
  if (event.data) {
    try {
      data = { ...fallback, ...event.data.json() }
    } catch {
      // Payload que nao e JSON ainda vale como aviso: melhor mostrar o texto
      // cru do que engolir a notificacao.
      data = { ...fallback, body: event.data.text() || fallback.body }
    }
  }

  // O iOS exige que TODO push mostre uma notificacao visivel. Um push que nao
  // chama showNotification faz o sistema revogar a permissao do app.
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag,
      data: { url: data.url },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/'

  event.waitUntil(
    (async () => {
      const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true })

      // Com o PWA ja aberto, focar e navegar a janela existente. Abrir outra
      // deixaria duas instancias do mesmo app na tela de multitarefa.
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue
        await client.focus()
        if ('navigate' in client) {
          await client.navigate(target).catch(() => {})
        }
        return
      }

      await clients.openWindow(target)
    })(),
  )
})
