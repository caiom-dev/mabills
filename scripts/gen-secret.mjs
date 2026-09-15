#!/usr/bin/env node
/**
 * Gera um SESSION_SECRET aleatorio de 256 bits.
 *
 * Uso:  npm run secret
 */
import { randomBytes } from 'node:crypto'

const secret = randomBytes(32).toString('hex')

console.log('\nSESSION_SECRET gerado.\n')
console.log(secret)
console.log('\nRode o comando abaixo e cole esse valor quando for pedido:\n')
console.log('  npx wrangler secret put SESSION_SECRET\n')
console.log('Trocar esse valor no futuro desconecta todas as sessoes ativas.\n')
