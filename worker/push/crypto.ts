/**
 * Criptografia da mensagem push (RFC 8291, content-encoding aes128gcm).
 *
 * Por que isto existe em vez de uma biblioteca: as bibliotecas de web push do
 * npm dependem do modulo `crypto` do Node, que nao existe no runtime do
 * Workers. Tudo aqui sai do WebCrypto, que o Workers implementa.
 *
 * O ponto que justifica o trabalho: o payload e cifrado PARA O APARELHO, com
 * uma chave que so ele tem. O servico de push da Apple e um intermediario cego
 * - ele entrega bytes que nao consegue ler. Por isso a notificacao pode trazer
 * "Mercado estourou o teto" no corpo, em vez de acordar o app para ir buscar o
 * texto (que exigiria sessao valida e rede no momento da entrega).
 */

const encoder = new TextEncoder()

// ---------------------------------------------------------------------------
// base64url
// ---------------------------------------------------------------------------

export function b64urlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

export function bytesToB64url(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// ---------------------------------------------------------------------------
// Chave de assinatura VAPID
// ---------------------------------------------------------------------------

/**
 * Remonta a chave privada de assinatura a partir do par VAPID.
 *
 * O `npm run vapid` guarda so o escalar `d` da privada; x e y saem da publica,
 * que e um ponto nao comprimido (0x04 seguido de 32 bytes de x e 32 de y). E o
 * unico jeito de o WebCrypto aceitar a chave sem guardar o JWK inteiro num
 * secret.
 */
export async function importVapidSigningKey(
  publicKeyB64: string,
  privateKeyB64: string,
): Promise<CryptoKey> {
  const publicBytes = b64urlToBytes(publicKeyB64)
  if (publicBytes.length !== 65 || publicBytes[0] !== 0x04) {
    throw new Error('VAPID_PUBLIC_KEY inválida. Gere o par de novo com `npm run vapid`.')
  }

  return crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      d: privateKeyB64,
      x: bytesToB64url(publicBytes.slice(1, 33)),
      y: bytesToB64url(publicBytes.slice(33, 65)),
      ext: true,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

// ---------------------------------------------------------------------------
// Derivacao de chaves
// ---------------------------------------------------------------------------

/**
 * HKDF-SHA256. O WebCrypto ja implementa extract+expand; escrever os HMAC na
 * mao aqui seria so mais superficie para errar.
 */
async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  lengthBytes: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource },
    key,
    lengthBytes * 8,
  )
  return new Uint8Array(bits)
}

/** Rotulo de contexto do HKDF: sempre texto seguido de um byte zero. */
function label(text: string): Uint8Array {
  return concat(encoder.encode(text), Uint8Array.of(0))
}

// ---------------------------------------------------------------------------
// Cifragem
// ---------------------------------------------------------------------------

/**
 * Tamanho de registro anunciado no cabecalho. 4096 e o valor usado por todas as
 * implementacoes de referencia e o maximo que os servicos de push aceitam.
 */
const RECORD_SIZE = 4096

/** O registro cifrado leva a tag do GCM (16) e o byte delimitador (1). */
export const MAX_PAYLOAD_BYTES = RECORD_SIZE - 17

export interface SubscriptionKeys {
  /** Chave publica do aparelho, base64url (ponto nao comprimido de 65 bytes). */
  p256dh: string
  /** Segredo de autenticacao do aparelho, base64url (16 bytes). */
  auth: string
}

/**
 * Cifra `payload` para uma inscricao, no formato aes128gcm.
 *
 * O corpo devolvido ja e o que vai como body do POST para o endpoint:
 *   salt(16) | rs(4) | idlen(1) | chave publica efemera(65) | registro cifrado
 */
export async function encryptPayload(
  payload: string,
  keys: SubscriptionKeys,
): Promise<Uint8Array> {
  const plaintextBody = encoder.encode(payload)
  if (plaintextBody.length > MAX_PAYLOAD_BYTES) {
    throw new Error(`Payload de push excede ${MAX_PAYLOAD_BYTES} bytes.`)
  }

  const uaPublicBytes = b64urlToBytes(keys.p256dh)
  const authSecret = b64urlToBytes(keys.auth)

  const uaPublicKey = await crypto.subtle.importKey(
    'raw',
    uaPublicBytes as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    [],
  )

  // Par efemero: novo a cada mensagem, de proposito. E o que garante que duas
  // notificacoes para o mesmo aparelho nao compartilhem chave de conteudo.
  const ephemeral = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  )
  const asPublicBytes = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey))

  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPublicKey }, ephemeral.privateKey, 256),
  )

  // Primeiro HKDF: mistura o segredo do ECDH com o `auth` do aparelho. O info
  // amarra as DUAS chaves publicas, o que impede reaproveitar o material
  // derivado com outro par.
  const keyInfo = concat(label('WebPush: info'), uaPublicBytes, asPublicBytes)
  const ikm = await hkdf(authSecret, sharedSecret, keyInfo, 32)

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const contentKey = await hkdf(salt, ikm, label('Content-Encoding: aes128gcm'), 16)
  const nonce = await hkdf(salt, ikm, label('Content-Encoding: nonce'), 12)

  // 0x02 e o delimitador de fim de conteudo do ultimo registro. Sem ele o
  // aparelho descarta a mensagem sem qualquer aviso.
  const plaintext = concat(plaintextBody, Uint8Array.of(2))

  const aesKey = await crypto.subtle.importKey(
    'raw',
    contentKey as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  )
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce as BufferSource, tagLength: 128 },
      aesKey,
      plaintext as BufferSource,
    ),
  )

  const header = new Uint8Array(5)
  new DataView(header.buffer).setUint32(0, RECORD_SIZE, false)
  header[4] = asPublicBytes.length

  return concat(salt, header, asPublicBytes, ciphertext)
}
