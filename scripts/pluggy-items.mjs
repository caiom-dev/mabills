#!/usr/bin/env node
/**
 * Descobre os itemId das suas conexões no Pluggy.
 *
 * Uso:
 *   npm run pluggy:items              # lista as conexões
 *   npm run pluggy:items -- <id>...   # confere ids que você já tem
 *
 * Por que este script existe: o Pluggy NÃO oferece listagem de conexões na API
 * pública - a documentação diz, com todas as letras, que cabe a quem integra
 * guardar os `itemId`. Existe um `GET /v2/items`, mas ele é opt-in e vem
 * desligado. Então aqui tentamos o caminho fácil e, quando ele está fechado,
 * dizemos exatamente onde olhar no Dashboard em vez de deixar você adivinhando.
 *
 * As credenciais vêm do ambiente ou do .dev.vars; se não houver, são pedidas no
 * terminal e não ficam gravadas em lugar nenhum.
 *
 * Nada aqui usa process.exit(): no Windows, encerrar à força com conexões de
 * fetch abertas dispara um assert do libuv e devolve 127 no lugar do código
 * real. Todos os caminhos ajustam `process.exitCode` e retornam.
 */

import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const BASE = 'https://api.pluggy.ai'

const dim = (s) => `\x1b[90m${s}\x1b[0m`
const bold = (s) => `\x1b[1m${s}\x1b[0m`
const green = (s) => `\x1b[32m${s}\x1b[0m`
const red = (s) => `\x1b[31m${s}\x1b[0m`
const yellow = (s) => `\x1b[33m${s}\x1b[0m`

function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

/** Lê uma chave do .dev.vars, com ou sem aspas. */
function fromDevVars(key) {
  try {
    const content = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8')
    const match = content.match(new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\n\\r]*)"?`, 'm'))
    return match?.[1]?.trim() || null
  } catch {
    return null
  }
}

async function credentials() {
  const clientId =
    process.env.PLUGGY_CLIENT_ID || fromDevVars('PLUGGY_CLIENT_ID') || (await ask('clientId: '))
  const clientSecret =
    process.env.PLUGGY_CLIENT_SECRET ||
    fromDevVars('PLUGGY_CLIENT_SECRET') ||
    (await ask('clientSecret: '))

  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

async function authenticate({ clientId, clientSecret }) {
  const res = await fetch(`${BASE}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }),
  })
  const text = await res.text()

  if (!res.ok) {
    console.error(red(`\nO Pluggy recusou as credenciais (HTTP ${res.status}).`))
    console.error(dim(`  ${text.slice(0, 200)}`))
    console.error('\nclientId e clientSecret estão no Dashboard, dentro da sua aplicação.\n')
    return null
  }

  const apiKey = JSON.parse(text).apiKey
  if (!apiKey) {
    console.error(red('\nO Pluggy respondeu ao /auth sem apiKey.\n'))
    return null
  }
  return apiKey
}

const get = (apiKey, path) => fetch(`${BASE}${path}`, { headers: { 'X-API-KEY': apiKey } })

/** As contas de um item: é o que deixa óbvio qual conexão é qual banco. */
async function describeAccounts(apiKey, itemId) {
  try {
    const res = await get(apiKey, `/accounts?itemId=${encodeURIComponent(itemId)}`)
    if (!res.ok) return []
    const body = await res.json()
    return (body.results ?? []).map(
      (a) => `${a.name}${a.type === 'CREDIT' ? ' (crédito)' : ''}${a.number ? ` ·${a.number}` : ''}`,
    )
  } catch {
    return []
  }
}

function printItem(item, accounts) {
  const connector = item.connector?.name ?? 'conector desconhecido'
  const healthy = item.status === 'UPDATED' || item.status === 'UPDATING'

  console.log(`  ${bold(item.id)}`)
  console.log(`    ${connector}${item.status ? dim(` · ${item.status}`) : ''}`)
  for (const account of accounts) console.log(dim(`    ${account}`))
  if (item.status && !healthy) {
    console.log(yellow('    precisa ser reconectado em meu.pluggy.ai'))
  }
}

function printSecretHint(ids) {
  console.log(`${bold('Valor para PLUGGY_ITEM_IDS:')}\n`)
  console.log(`  ${ids.join(',')}\n`)
  console.log(dim('  npx wrangler secret put PLUGGY_ITEM_IDS\n'))
}

function printDashboardHelp() {
  console.log(`\n${yellow('A API não listou as conexões desta aplicação.')}\n`)
  console.log('Isso é o esperado: o endpoint de listagem (GET /v2/items) vem desligado')
  console.log('por padrão, e a documentação do Pluggy diz que guardar os itemId é')
  console.log('responsabilidade de quem integra.\n')
  console.log(bold('Onde achar no Dashboard:\n'))
  console.log('  1. Entre em dashboard.pluggy.ai com a MESMA conta da aplicação')
  console.log('  2. Abra a sua aplicação')
  console.log('  3. Vá em "Dados Financeiros" (ou "Financial Data" / "Items")')
  console.log('  4. Cada conexão mostra o id — é um UUID, no formato')
  console.log(dim('     1a2b3c4d-5e6f-7890-abcd-ef1234567890\n'))
  console.log('Com os ids em mãos, confira se estão certos antes de gravar:\n')
  console.log(`  ${bold('npm run pluggy:items -- <id1> <id2>')}\n`)
  console.log(dim('Se o Dashboard não mostrar os ids, peça ao suporte do Pluggy para'))
  console.log(dim('habilitar GET /v2/items na sua conta e rode este script de novo.\n'))
}

// ---------------------------------------------------------------------------

async function checkGivenIds(apiKey, ids) {
  console.log(`\nConferindo ${ids.length} id(s):\n`)
  const valid = []

  for (const id of ids) {
    const res = await get(apiKey, `/items/${encodeURIComponent(id)}`)
    if (res.ok) {
      const item = await res.json()
      printItem(item, await describeAccounts(apiKey, id))
      valid.push(id)
    } else {
      console.log(`  ${red(id)}`)
      console.log(dim(`    não encontrado nesta aplicação (HTTP ${res.status})`))
    }
    console.log('')
  }

  if (valid.length > 0) printSecretHint(valid)
  return valid.length === ids.length ? 0 : 1
}

async function discover(apiKey) {
  const items = []
  let cursor = null

  for (;;) {
    const res = await get(apiKey, `/v2/items${cursor ? `?after=${encodeURIComponent(cursor)}` : ''}`)
    if (!res.ok) {
      printDashboardHelp()
      return 0
    }
    const body = await res.json()
    items.push(...(body.results ?? []))
    cursor = body.next ?? null
    if (!cursor) break
  }

  if (items.length === 0) {
    console.log(`\n${yellow('Nenhuma conexão nesta aplicação.')}\n`)
    console.log('Conecte os bancos em meu.pluggy.ai e, no Dashboard, autorize o')
    console.log('conector MeuPluggy — uma vez para cada banco.\n')
    return 0
  }

  console.log(`\n${items.length} conexão(ões) encontrada(s):\n`)
  for (const item of items) {
    printItem(item, await describeAccounts(apiKey, item.id))
    console.log('')
  }
  printSecretHint(items.map((i) => i.id))
  return 0
}

async function main() {
  const wanted = process.argv.slice(2).filter((arg) => !arg.startsWith('-'))

  console.log(`\n${bold('Conexões do Pluggy')}\n`)

  const creds = await credentials()
  if (!creds) {
    console.error(red('clientId e clientSecret são obrigatórios.\n'))
    return 1
  }

  const apiKey = await authenticate(creds)
  if (!apiKey) return 1

  console.log(green('autenticado no Pluggy'))

  return wanted.length > 0 ? checkGivenIds(apiKey, wanted) : discover(apiKey)
}

process.exitCode = await main()
