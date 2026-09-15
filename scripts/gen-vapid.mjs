#!/usr/bin/env node
/**
 * Gera o par de chaves VAPID usado pelas notificacoes push.
 *
 * Uso:  npm run vapid
 *
 * VAPID e o que prova ao servico de push da Apple/Google que o push veio do
 * SEU servidor. A chave publica tambem vai para o navegador no momento da
 * inscricao, e o par fica amarrado as inscricoes existentes: trocar as chaves
 * invalida todas elas, e cada aparelho precisa aceitar de novo.
 */
import { webcrypto } from 'node:crypto'

function toBase64Url(buffer) {
  return Buffer.from(buffer).toString('base64url')
}

const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
  'sign',
  'verify',
])

// A chave publica vai no formato "raw" (ponto nao comprimido, 65 bytes
// comecando com 0x04) porque e isso que o navegador espera em
// applicationServerKey. Ja a privada guardamos so o escalar `d` (32 bytes) -
// o Worker remonta o JWK a partir dele e da publica.
const publicRaw = await webcrypto.subtle.exportKey('raw', pair.publicKey)
const privateJwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey)

console.log('\nChaves VAPID geradas.\n')
console.log('VAPID_PUBLIC_KEY')
console.log(toBase64Url(publicRaw))
console.log('\nVAPID_PRIVATE_KEY')
console.log(privateJwk.d)
console.log('\nRode os comandos abaixo e cole cada valor quando for pedido:\n')
console.log('  npx wrangler secret put VAPID_PUBLIC_KEY')
console.log('  npx wrangler secret put VAPID_PRIVATE_KEY\n')
console.log('Para desenvolvimento, cole os dois no .dev.vars.\n')
console.log('Guarde o par. Gerar outro desliga as notificacoes de todos os')
console.log('aparelhos ja inscritos - cada um precisa autorizar de novo.\n')
