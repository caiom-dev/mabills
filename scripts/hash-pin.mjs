#!/usr/bin/env node
/**
 * Gera o valor de APP_PIN_HASH a partir de um PIN.
 *
 * Uso:  npm run pin
 *
 * O PIN e lido do terminal (nao entra no historico do shell) e a derivacao usa
 * exatamente os mesmos parametros do Worker: PBKDF2-SHA256, 25.000 iteracoes,
 * salt aleatorio de 16 bytes por instalacao.
 */
import { webcrypto, randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline'

const ITERATIONS = 25_000

function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const pin = await ask('Escolha um PIN (minimo 6 caracteres, pode ser uma frase): ')

if (pin.length < 6) {
  console.error('\nPIN muito curto. Use pelo menos 6 caracteres.')
  process.exit(1)
}
if (/^(\d)\1+$/.test(pin) || pin === '123456' || pin === '000000') {
  console.error('\nEsse PIN e facil demais de adivinhar. Escolha outro.')
  process.exit(1)
}

const salt = randomBytes(16)
const key = await webcrypto.subtle.importKey(
  'raw',
  new TextEncoder().encode(pin),
  'PBKDF2',
  false,
  ['deriveBits'],
)
const bits = await webcrypto.subtle.deriveBits(
  { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
  key,
  256,
)

const value = `${salt.toString('hex')}:${toHex(bits)}`

console.log('\nAPP_PIN_HASH gerado.\n')
console.log(value)
console.log('\nAgora rode o comando abaixo e cole esse valor quando for pedido:\n')
console.log('  npx wrangler secret put APP_PIN_HASH\n')
console.log('Guarde o PIN. O hash nao permite recupera-lo - se esquecer, gere outro.\n')
