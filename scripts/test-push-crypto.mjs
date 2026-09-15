#!/usr/bin/env node
/**
 * Teste de ida e volta da criptografia de push (RFC 8291).
 *
 * Uso:  npm run test:push
 *
 * Por que este teste existe separado do smoke: a cifragem e a unica parte do
 * app cujo erro nao aparece em lugar nenhum. Uma derivacao de chave errada nao
 * causa 500 nem log - o servico de push aceita os bytes, entrega ao iPhone, e o
 * iPhone descarta a mensagem em silencio. Depurar isso pelo aparelho e cego.
 *
 * Aqui o teste faz o papel do aparelho: gera o par de chaves que o navegador
 * geraria, manda cifrar, e decifra pelo caminho inverso. Se o texto volta
 * igual, a derivacao esta certa.
 *
 * O import do .ts depende do strip-types do Node 22.6+; o package.json ja passa
 * a flag.
 */

import { encryptPayload, importVapidSigningKey } from '../worker/push/crypto.ts'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

let pass = 0
let fail = 0

function ok(name, detail = '') {
  pass++
  console.log(`  \x1b[32mOK\x1b[0m   ${name}${detail ? ` \x1b[90m${detail}\x1b[0m` : ''}`)
}

function bad(name, detail) {
  fail++
  console.log(`  \x1b[31mFALHA\x1b[0m ${name} \x1b[90m${detail}\x1b[0m`)
}

function b64url(buffer) {
  return Buffer.from(buffer).toString('base64url')
}

function concat(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function label(text) {
  return concat(encoder.encode(text), Uint8Array.of(0))
}

async function hkdf(salt, ikm, info, lengthBytes) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    lengthBytes * 8,
  )
  return new Uint8Array(bits)
}

/** O papel do aparelho: gera o par ECDH e o segredo de autenticacao. */
async function createDevice() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])
  const publicBytes = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  const authSecret = crypto.getRandomValues(new Uint8Array(16))

  return {
    privateKey: pair.privateKey,
    publicBytes,
    authSecret,
    keys: { p256dh: b64url(publicBytes), auth: b64url(authSecret) },
  }
}

/** O caminho inverso, exatamente como o navegador do aparelho faria. */
async function decrypt(device, body) {
  const salt = body.slice(0, 16)
  const idlen = body[20]
  const asPublicBytes = body.slice(21, 21 + idlen)
  const ciphertext = body.slice(21 + idlen)

  const asPublicKey = await crypto.subtle.importKey(
    'raw',
    asPublicBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    [],
  )
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: asPublicKey }, device.privateKey, 256),
  )

  const keyInfo = concat(label('WebPush: info'), device.publicBytes, asPublicBytes)
  const ikm = await hkdf(device.authSecret, sharedSecret, keyInfo, 32)
  const contentKey = await hkdf(salt, ikm, label('Content-Encoding: aes128gcm'), 16)
  const nonce = await hkdf(salt, ikm, label('Content-Encoding: nonce'), 12)

  const aesKey = await crypto.subtle.importKey('raw', contentKey, { name: 'AES-GCM' }, false, [
    'decrypt',
  ])
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, ciphertext),
  )

  // O ultimo byte e o delimitador 0x02, nao faz parte do conteudo.
  const delimiter = plaintext[plaintext.length - 1]
  return { text: decoder.decode(plaintext.slice(0, -1)), delimiter }
}

console.log('\nCriptografia de push (RFC 8291)\n')

// ---------------------------------------------------------------------------
{
  const device = await createDevice()
  const payload = JSON.stringify({
    title: 'Teto estourado',
    body: 'Mercado estourou R$ 143,20 acima do teto',
    url: '/categorias',
  })

  const body = await encryptPayload(payload, device.keys)

  if (body.length > 21 && body[20] === 65) {
    ok('cabecalho aes128gcm', `salt 16B · rs 4B · chave efemera ${body[20]}B`)
  } else {
    bad('cabecalho aes128gcm', `idlen=${body[20]}`)
  }

  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16, false)
  if (rs === 4096) ok('record size anunciado', '4096')
  else bad('record size anunciado', `rs=${rs}`)

  try {
    const { text, delimiter } = await decrypt(device, body)
    if (text === payload) {
      ok('o aparelho decifra o payload', `${payload.length} bytes intactos`)
    } else {
      bad('o aparelho decifra o payload', `voltou: ${text.slice(0, 80)}`)
    }
    if (delimiter === 2) ok('delimitador de fim de registro', '0x02')
    else bad('delimitador de fim de registro', `0x${delimiter?.toString(16)}`)
  } catch (err) {
    bad('o aparelho decifra o payload', err.message)
  }
}

// ---------------------------------------------------------------------------
{
  // Acentos sao o caso que quebra quem conta caracteres em vez de bytes.
  const device = await createDevice()
  const payload = JSON.stringify({ title: 'Alimentação', body: 'Restaurante · R$ 1.234,56' })
  const body = await encryptPayload(payload, device.keys)
  const { text } = await decrypt(device, body)

  if (text === payload) ok('texto com acento sobrevive', 'UTF-8 preservado')
  else bad('texto com acento sobrevive', `voltou: ${text}`)
}

// ---------------------------------------------------------------------------
{
  // Cada mensagem usa um par efemero novo; dois envios iguais nao podem gerar
  // os mesmos bytes, senao a chave de conteudo estaria sendo reaproveitada.
  const device = await createDevice()
  const payload = JSON.stringify({ title: 'a', body: 'b' })
  const first = await encryptPayload(payload, device.keys)
  const second = await encryptPayload(payload, device.keys)

  const sameKey = Buffer.compare(
    Buffer.from(first.slice(21, 86)),
    Buffer.from(second.slice(21, 86)),
  )
  if (sameKey !== 0) ok('chave efemera nova a cada mensagem')
  else bad('chave efemera nova a cada mensagem', 'os dois envios usaram a mesma')

  const sameSalt = Buffer.compare(Buffer.from(first.slice(0, 16)), Buffer.from(second.slice(0, 16)))
  if (sameSalt !== 0) ok('salt novo a cada mensagem')
  else bad('salt novo a cada mensagem', 'os dois envios usaram o mesmo')
}

// ---------------------------------------------------------------------------
{
  // Outro aparelho nao pode ler a mensagem: e o ponto inteiro da cifragem.
  const alice = await createDevice()
  const mallory = await createDevice()
  const body = await encryptPayload(JSON.stringify({ title: 'sigilo' }), alice.keys)

  try {
    await decrypt(mallory, body)
    bad('outro aparelho nao decifra', 'a mensagem foi lida por quem nao devia')
  } catch {
    ok('outro aparelho nao decifra', 'chave de conteudo e por aparelho')
  }
}

// ---------------------------------------------------------------------------
{
  // Payload grande demais precisa falhar aqui, e nao virar uma notificacao que
  // o aparelho descarta sem dizer nada.
  const device = await createDevice()
  try {
    await encryptPayload('x'.repeat(5000), device.keys)
    bad('payload acima do limite e recusado', 'passou sem erro')
  } catch (err) {
    if (/excede/.test(err.message)) ok('payload acima do limite e recusado', err.message)
    else bad('payload acima do limite e recusado', err.message)
  }
}

// ---------------------------------------------------------------------------
{
  // A chave de assinatura e remontada a partir de (publica raw + escalar d).
  // Se x, y ou d entrarem trocados, a assinatura sai bem formada e mesmo assim
  // invalida - e o unico sintoma seria um 403 do servico de push, sem pista.
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey)

  const publicKeyB64 = b64url(publicRaw)
  const signingKey = await importVapidSigningKey(publicKeyB64, privateJwk.d)

  const message = encoder.encode('eyJ0eXAiOiJKV1QifQ.eyJhdWQiOiJodHRwczovL2V4ZW1wbG8ifQ')
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, message)

  // Verifica com a chave publica ORIGINAL: e o que prova que a remontagem
  // produziu de fato o par correspondente.
  const verified = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    pair.publicKey,
    signature,
    message,
  )

  if (verified) ok('chave VAPID remontada assina de verdade', 'ES256 verificada pela publica')
  else bad('chave VAPID remontada assina de verdade', 'assinatura nao confere')

  if (signature.byteLength === 64) ok('assinatura no formato cru', '64 bytes (r||s)')
  else bad('assinatura no formato cru', `${signature.byteLength} bytes`)

  try {
    await importVapidSigningKey('chave-invalida', privateJwk.d)
    bad('chave publica malformada e recusada', 'passou sem erro')
  } catch (err) {
    if (/VAPID_PUBLIC_KEY/.test(err.message)) {
      ok('chave publica malformada e recusada', 'erro aponta o secret certo')
    } else {
      bad('chave publica malformada e recusada', err.message)
    }
  }
}

console.log('\n----------------------------------------------------')
console.log(`${pass} passaram, ${fail} falharam\n`)
if (fail > 0) process.exit(1)
console.log('Tudo certo.\n')
