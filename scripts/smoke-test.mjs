#!/usr/bin/env node
/**
 * Smoke test da API contra um servidor local.
 *
 * Nao substitui testes de unidade: a intencao e pegar rapido as falhas que
 * realmente derrubam o app - rota que nao existe, contrato divergente do que o
 * frontend espera, 500 silencioso, sessao que nao gruda.
 *
 * Uso:
 *   1) npx wrangler dev            (em outro terminal)
 *   2) node scripts/smoke-test.mjs
 */

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:8787'
const PIN = process.env.SMOKE_PIN ?? 'mabills-dev'

/**
 * Sufixo unico por execucao.
 *
 * A API recusa apagar lancamento importado de proposito - ele voltaria no
 * proximo sync. Sem um sufixo por execucao, a segunda rodada contra o mesmo
 * banco veria os lancamentos da primeira como duplicados e quatro checagens
 * falhariam sem que nada estivesse quebrado.
 */
const RUN = Date.now().toString(36).slice(-6)

/**
 * Conta propria por execucao.
 *
 * A deduplicacao tambem olha data+valor+conta, de proposito: um extrato
 * reexportado pode trazer FITID novo para o mesmo lancamento. Isso significa
 * que sufixo no FITID nao basta - na conta padrao, os lancamentos da execucao
 * anterior barrariam os desta pela chave de valor. Conta propria isola cada
 * rodada sem enfraquecer a deduplicacao.
 */
const ACCOUNT = `smoke_${RUN}`

let cookie = ''
let pass = 0
let fail = 0
const failures = []

function ok(name, detail = '') {
  pass++
  console.log(`  \x1b[32mOK\x1b[0m   ${name}${detail ? ` \x1b[90m${detail}\x1b[0m` : ''}`)
}

function bad(name, detail) {
  fail++
  failures.push(`${name}: ${detail}`)
  console.log(`  \x1b[31mFALHA\x1b[0m ${name} \x1b[90m${detail}\x1b[0m`)
}

async function call(method, path, body) {
  const headers = { 'Content-Type': 'application/json' }
  if (cookie) headers.Cookie = cookie
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) cookie = setCookie.split(';')[0]

  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* resposta nao-JSON e tratada por quem chamou */
  }
  return { status: res.status, json, text, contentType: res.headers.get('content-type') ?? '' }
}

/** Checa que o objeto tem as chaves esperadas - pega divergencia de contrato. */
function hasKeys(obj, keys) {
  if (obj === null || typeof obj !== 'object') return `nao e objeto (${typeof obj})`
  const missing = keys.filter((k) => !(k in obj))
  return missing.length ? `faltam campos: ${missing.join(', ')}` : null
}

console.log(`\nSmoke test em ${BASE}\n`)

// ---------------------------------------------------------------------------
console.log('Autenticacao')
// ---------------------------------------------------------------------------

{
  const r = await call('GET', '/api/summary')
  if (r.status === 401) ok('rota protegida devolve 401 sem sessao')
  else bad('rota protegida devolve 401 sem sessao', `veio ${r.status}`)

  // Um 302 aqui quebraria o PWA no iPhone: o fetch da SPA receberia um redirect
  // cross-origin e viraria erro opaco de CORS, deixando a tela em branco.
  if (r.status === 302 || r.status === 301) bad('401 e JSON, nunca redirect', 'veio redirect')
  else if (r.contentType.includes('json')) ok('401 responde JSON, nao redirect')
  else bad('401 responde JSON', `content-type ${r.contentType}`)
}

{
  const r = await call('POST', '/api/auth/login', { pin: 'pin-errado-de-proposito' })
  if (r.status === 401 || r.status === 429) ok('PIN errado e rejeitado', `status ${r.status}`)
  else bad('PIN errado e rejeitado', `veio ${r.status}`)
}

{
  const r = await call('POST', '/api/auth/login', { pin: PIN })
  if (r.status === 200 && cookie) ok('login com PIN correto', 'cookie recebido')
  else bad('login com PIN correto', `status ${r.status}, cookie=${cookie ? 'sim' : 'nao'}`)
}

{
  const r = await call('GET', '/api/auth/me')
  if (r.status === 200 && r.json?.authenticated === true) ok('sessao valida apos login')
  else bad('sessao valida apos login', `status ${r.status} body ${r.text.slice(0, 120)}`)
}

// ---------------------------------------------------------------------------
console.log('\nLeitura')
// ---------------------------------------------------------------------------

const month = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 7)

{
  const r = await call('GET', `/api/summary?month=${month}`)
  if (r.status !== 200) {
    bad('GET /summary', `status ${r.status} ${r.text.slice(0, 200)}`)
  } else {
    const miss = hasKeys(r.json, [
      'month',
      'totalSpent',
      'totalIncome',
      'totalBudget',
      'remaining',
      'pace',
      'budgets',
      'attention',
      'recentTransactions',
      'uncategorizedCount',
    ])
    if (miss) bad('contrato de MonthSummary', miss)
    else ok('GET /summary', `${r.json.budgets.length} categorias`)

    const paceMiss = hasKeys(r.json.pace ?? {}, [
      'status',
      'monthElapsed',
      'budgetUsed',
      'projectedSpend',
      'safeDailySpend',
      'daysLeft',
    ])
    if (paceMiss) bad('contrato de Pace', paceMiss)
    else ok('contrato de Pace')
  }
}

{
  const r = await call('GET', '/api/categories')
  if (r.status === 200 && Array.isArray(r.json) && r.json.length >= 11) {
    const miss = hasKeys(r.json[0], ['id', 'name', 'kind', 'colorSlot', 'sortOrder'])
    if (miss) bad('contrato de Category', miss)
    else ok('GET /categories', `${r.json.length} categorias`)
    const slots = r.json.map((c) => c.colorSlot)
    if (slots.every((s) => Number.isInteger(s) && s >= 0 && s <= 8)) ok('colorSlot dentro de 0..8')
    else bad('colorSlot dentro de 0..8', `valores: ${[...new Set(slots)].join(',')}`)
  } else {
    bad('GET /categories', `status ${r.status} ${r.text.slice(0, 200)}`)
  }
}

for (const [name, path, checker] of [
  ['GET /transactions', `/api/transactions?month=${month}`, (j) => hasKeys(j, ['items', 'total', 'hasMore'])],
  ['GET /budgets', `/api/budgets?month=${month}`, (j) => (Array.isArray(j) ? null : 'nao e array')],
  ['GET /breakdown', `/api/breakdown?month=${month}`, (j) => (Array.isArray(j) ? null : 'nao e array')],
  ['GET /trends', '/api/trends?months=6', (j) => (Array.isArray(j) ? null : 'nao e array')],
  ['GET /rules', '/api/rules', (j) => (Array.isArray(j) ? null : 'nao e array')],
  ['GET /accounts', '/api/accounts', (j) => (Array.isArray(j) ? null : 'nao e array')],
  ['GET /sync/status', '/api/sync/status', (j) => hasKeys(j, ['lastSyncAt', 'configured', 'accounts'])],
  ['GET /budgets/suggestions', `/api/budgets/suggestions?month=${month}`, (j) => (Array.isArray(j) ? null : 'nao e array')],
]) {
  const r = await call('GET', path)
  if (r.status !== 200) bad(name, `status ${r.status} ${r.text.slice(0, 160)}`)
  else {
    const problem = checker(r.json)
    if (problem) bad(name, problem)
    else ok(name)
  }
}

// ---------------------------------------------------------------------------
console.log('\nEscrita')
// ---------------------------------------------------------------------------

let createdTxId = null
let mercadoId = null

{
  const cats = await call('GET', '/api/categories')
  mercadoId = Array.isArray(cats.json)
    ? (cats.json.find((c) => c.name === 'Mercado')?.id ?? null)
    : null
  if (mercadoId === null) bad('categoria Mercado disponivel', 'nao encontrada')
}

{
  const r = await call('POST', '/api/transactions', {
    date: `${month}-15`,
    amount: 123.45,
    description: 'Teste smoke - mercado',
    categoryId: mercadoId,
    kind: 'expense',
  })
  if (r.status === 200 || r.status === 201) {
    createdTxId = r.json?.id ?? null
    if (r.json?.amount === -123.45) ok('lancamento manual grava saida com sinal negativo')
    else bad('sinal do lancamento manual', `amount = ${r.json?.amount} (esperado -123.45)`)
  } else {
    bad('POST /transactions', `status ${r.status} ${r.text.slice(0, 200)}`)
  }
}

if (createdTxId) {
  const r = await call('GET', `/api/transactions?month=${month}`)
  const found = r.json?.items?.find((t) => t.id === createdTxId)
  if (found) ok('transacao criada aparece na listagem')
  else bad('transacao criada aparece na listagem', 'nao encontrada')

  const s = await call('GET', `/api/summary?month=${month}`)
  if ((s.json?.totalSpent ?? 0) >= 123.45) ok('gasto entra no total do mes')
  else bad('gasto entra no total do mes', `totalSpent = ${s.json?.totalSpent}`)

  // Transferencia NAO pode entrar no total.
  //
  // Esta checagem nasceu de um bug real em producao: pagamento de fatura,
  // aplicacao e resgate contavam como gasto e o mes fechou R$ 6 mil acima do
  // que o usuario tinha gastado de fato. O teto por categoria filtrava
  // kind='expense'; o total do topo nao - e as duas telas discordavam.
  const catList = await call('GET', '/api/categories')
  const transferId = Array.isArray(catList.json)
    ? (catList.json.find((c) => c.name === 'Transferencias')?.id ?? null)
    : null

  if (transferId === null) {
    bad('categoria Transferencias disponivel', 'nao encontrada no seed')
  } else {
    const antes = s.json?.totalSpent ?? 0
    const t = await call('POST', '/api/transactions', {
      date: `${month}-16`,
      amount: 5000,
      description: 'Teste smoke - pagamento de fatura',
      categoryId: transferId,
      kind: 'expense',
    })

    if (t.status !== 200 && t.status !== 201) {
      bad('POST /transactions (transferencia)', `status ${t.status}`)
    } else {
      const depois = await call('GET', `/api/summary?month=${month}`)
      const total = depois.json?.totalSpent ?? 0
      if (Math.abs(total - antes) < 0.01) {
        ok('transferencia NAO entra no total de gastos', `totalSpent segue ${total}`)
      } else {
        bad(
          'transferencia NAO entra no total de gastos',
          `totalSpent foi de ${antes} para ${total}`,
        )
      }

      // O detalhamento alimenta o grafico de composicao: uma transferencia ali
      // apareceria como a maior "despesa" do mes.
      const breakdown = await call('GET', `/api/breakdown?month=${month}`)
      const vazou = Array.isArray(breakdown.json)
        ? breakdown.json.some((b) => b.categoryName === 'Transferencias')
        : false
      if (vazou) bad('transferencia fora do detalhamento', 'apareceu no /breakdown')
      else ok('transferencia fora do detalhamento')

      if (t.json?.id) await call('DELETE', `/api/transactions/${t.json.id}`)
    }
  }
}

if (mercadoId) {
  const r = await call('PUT', '/api/budgets', {
    categoryId: mercadoId,
    month: '*',
    limitAmount: 800,
  })
  if (r.status === 200) ok('PUT /budgets define teto recorrente')
  else bad('PUT /budgets', `status ${r.status} ${r.text.slice(0, 200)}`)

  const b = await call('GET', `/api/budgets?month=${month}`)
  const row = b.json?.find?.((x) => x.categoryId === mercadoId)
  if (row?.limitAmount === 800) ok("teto '*' vale para o mes corrente", 'COALESCE funcionando')
  else bad("teto '*' vale para o mes corrente", `limitAmount = ${row?.limitAmount}`)

  if (row && typeof row.percent === 'number' && row.state) {
    ok('BudgetProgress traz percent e state', `state=${row.state}`)
  } else {
    bad('BudgetProgress traz percent e state', JSON.stringify(row).slice(0, 160))
  }
}

if (createdTxId) {
  const r = await call('DELETE', `/api/transactions/${createdTxId}`)
  if (r.status === 200) ok('DELETE de transacao manual')
  else bad('DELETE de transacao manual', `status ${r.status}`)
}

// ---------------------------------------------------------------------------
console.log('\nImportacao')
// ---------------------------------------------------------------------------

{
  const ofx = `OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>${month.replace('-', '')}10<TRNAMT>-89.90<FITID>SMOKE001${RUN}<MEMO>IFOOD *RESTAURANTE</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>${month.replace('-', '')}11<TRNAMT>-45.00<FITID>SMOKE002${RUN}<MEMO>UBER TRIP</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`

  const r = await call('POST', '/api/import/preview', {
    filename: 'extrato.ofx',
    content: ofx,
    accountId: ACCOUNT,
  })
  if (r.status !== 200) {
    bad('POST /import/preview (OFX)', `status ${r.status} ${r.text.slice(0, 200)}`)
  } else if (r.json?.rows?.length === 2) {
    ok('OFX parseado', `${r.json.newCount} novos`)
    const ifood = r.json.rows.find((x) => x.description?.toUpperCase().includes('IFOOD'))
    if (ifood?.suggestedCategoryName === 'Restaurante/Delivery') {
      ok('categorizacao automatica no preview', 'IFOOD -> Restaurante/Delivery')
    } else {
      bad('categorizacao automatica no preview', `sugerido: ${ifood?.suggestedCategoryName}`)
    }

    const commit = await call('POST', '/api/import/commit', { token: r.json.token })
    if (commit.status === 200 && commit.json?.inserted === 2) {
      ok('import commit gravou 2 lancamentos')

      // Reimportar o MESMO arquivo nao pode duplicar - e a garantia central.
      const again = await call('POST', '/api/import/preview', {
        filename: 'extrato.ofx',
        content: ofx,
        accountId: ACCOUNT,
      })
      if (again.json?.duplicateCount === 2 && again.json?.newCount === 0) {
        ok('reimportar o mesmo arquivo nao duplica', 'deduplicacao por FITID')
      } else {
        bad(
          'reimportar o mesmo arquivo nao duplica',
          `novos=${again.json?.newCount} dup=${again.json?.duplicateCount}`,
        )
      }
    } else {
      bad('import commit', `status ${commit.status} ${commit.text.slice(0, 200)}`)
    }
  } else {
    bad('OFX parseado', `linhas: ${r.json?.rows?.length}`)
  }
}

// ---------------------------------------------------------------------------
console.log('\nSincronizacao')
// ---------------------------------------------------------------------------

{
  // Sem credenciais do Pluggy o sync precisa degradar com elegancia, nunca 500.
  const r = await call('POST', '/api/sync')
  if (r.status === 200 && r.json?.status) {
    ok('POST /sync degrada sem credenciais do Pluggy', `status=${r.json.status}`)
  } else {
    bad('POST /sync sem credenciais', `status ${r.status} ${r.text.slice(0, 200)}`)
  }
}

// ---------------------------------------------------------------------------
console.log('\nRegra a partir de um lancamento')
// ---------------------------------------------------------------------------

{
  // Estabelecimento COM acento e de proposito: o padrao da regra e normalizado
  // (sem acento), entao so casa se o backfill comparar contra search_text.
  // Sem essa coluna, um LIKE '%acento%' erraria 'ÁÇÊNTÕ' silenciosamente.
  //
  // O nome e inventado, e nao um estabelecimento real, por dois motivos: uma
  // regra de verdade no banco ('mercado', 'uber') nao pode categorizar essas
  // linhas antes do PATCH - o backfill ficaria sem nada para recategorizar; e o
  // sufixo por execucao impede que a regra criada na rodada anterior, que
  // continua no banco, case com as linhas desta.
  const merchant = `ÁÇÊNTÕ SMOKE ${RUN}`
  const merchantPattern = `acento smoke ${RUN}`
  const ofx = `OFXHEADER:100
<OFX><BANKTRANLIST>
<STMTTRN><DTPOSTED>${month.replace('-', '')}05<TRNAMT>-70.00<FITID>SMOKERULE1${RUN}<MEMO>${merchant}</STMTTRN>
<STMTTRN><DTPOSTED>${month.replace('-', '')}12<TRNAMT>-55.50<FITID>SMOKERULE2${RUN}<MEMO>${merchant}</STMTTRN>
<STMTTRN><DTPOSTED>${month.replace('-', '')}19<TRNAMT>-38.20<FITID>SMOKERULE3${RUN}<MEMO>${merchant}</STMTTRN>
</BANKTRANLIST></OFX>`

  const prev = await call('POST', '/api/import/preview', {
    filename: 'a.ofx',
    content: ofx,
    accountId: ACCOUNT,
  })
  if (prev.status === 200 && prev.json?.token) {
    await call('POST', '/api/import/commit', { token: prev.json.token })

    const lazerId = (await call('GET', '/api/categories')).json?.find(
      (c) => c.name === 'Lazer',
    )?.id

    // Recategoriza UM lancamento e pede para aplicar aos demais.
    const patched = await call('PATCH', `/api/transactions/ofx_SMOKERULE1${RUN}`, {
      categoryId: lazerId,
      createRule: true,
      rulePattern: merchantPattern,
    })

    if (patched.status !== 200) {
      bad('PATCH com createRule', `status ${patched.status} ${patched.text.slice(0, 160)}`)
    } else if (!patched.json?.ruleCreated) {
      bad('regra criada a partir da transacao', 'ruleCreated veio nulo')
    } else {
      ok('regra criada a partir da transacao', `padrao "${patched.json.ruleCreated.pattern}"`)

      if (patched.json.backfilled >= 2) {
        ok('backfill recategorizou o historico', `${patched.json.backfilled} lançamentos`)
        ok('backfill casa texto com acento', `ÁÇÊNTÕ casou com "${merchantPattern}"`)
      } else {
        bad(
          'backfill recategorizou o historico',
          `backfilled=${patched.json.backfilled} (esperado >= 2)`,
        )
      }

      // A escolha manual do usuario nao pode ser desfeita por sync/regra.
      const list = await call('GET', `/api/transactions?month=${month}`)
      const edited = list.json?.items?.find((t) => t.id === `ofx_SMOKERULE1${RUN}`)
      if (edited?.categorySource === 'manual') {
        ok('escolha manual fica marcada como inviolavel', "categorySource='manual'")
      } else {
        bad('escolha manual marcada', `categorySource=${edited?.categorySource}`)
      }

      const sibling = list.json?.items?.find((t) => t.id === `ofx_SMOKERULE2${RUN}`)
      if (sibling?.categoryId === lazerId) {
        ok('lancamento irmao herdou a categoria da regra')
      } else {
        bad('lancamento irmao herdou a categoria', `categoryId=${sibling?.categoryId}`)
      }
    }
  } else {
    bad('preview do OFX com acento', `status ${prev.status}`)
  }
}

// ---------------------------------------------------------------------------
console.log('\nCriar categoria')
// ---------------------------------------------------------------------------

{
  // Criar categoria e a unica escrita do app que nao tinha cobertura nenhuma
  // aqui - e a UI so sabia criar despesa, entao os outros dois tipos nunca
  // tinham sido exercitados por ninguem.
  const criadas = []

  for (const [kind, slot] of [
    ['expense', 3],
    ['income', 6],
    ['transfer', 0],
  ]) {
    const nome = `Smoke ${kind} ${RUN}`
    const r = await call('POST', '/api/categories', { name: nome, kind, colorSlot: slot })

    if (r.status !== 200 && r.status !== 201) {
      bad(`cria categoria do tipo ${kind}`, `status ${r.status} ${r.text.slice(0, 140)}`)
    } else if (r.json?.kind !== kind || r.json?.colorSlot !== slot) {
      bad(
        `cria categoria do tipo ${kind}`,
        `voltou kind=${r.json?.kind} slot=${r.json?.colorSlot}`,
      )
    } else {
      ok(`cria categoria do tipo ${kind}`, `slot ${slot}`)
      criadas.push(r.json)
    }
  }

  if (criadas.length > 0) {
    const lista = await call('GET', '/api/categories')
    const todasPresentes = criadas.every((c) => lista.json?.some((x) => x.id === c.id))
    if (todasPresentes) ok('categoria criada aparece na listagem')
    else bad('categoria criada aparece na listagem', 'alguma nao voltou')

    // Nome repetido tem de ser recusado com mensagem, nao com 500 do UNIQUE.
    const dup = await call('POST', '/api/categories', {
      name: criadas[0].name,
      kind: 'expense',
      colorSlot: 2,
    })
    if (dup.status >= 400 && dup.status < 500 && dup.json?.error) {
      ok('nome repetido e recusado com mensagem', `status ${dup.status}`)
    } else {
      bad('nome repetido e recusado com mensagem', `status ${dup.status}`)
    }

    // Slot fora da paleta validada nao pode entrar: a validacao de daltonismo
    // vale para os 8 slots, um 9o seria indistinguivel.
    const slotInvalido = await call('POST', '/api/categories', {
      name: `Smoke slot ${RUN}`,
      kind: 'expense',
      colorSlot: 99,
    })
    if (slotInvalido.status === 400) ok('cor fora da paleta e recusada')
    else bad('cor fora da paleta e recusada', `status ${slotInvalido.status}`)

    // Uma categoria de transferencia recem-criada precisa REALMENTE ficar fora
    // do total - e o motivo de o tipo existir.
    const transfer = criadas.find((c) => c.kind === 'transfer')
    if (transfer) {
      const antes = (await call('GET', `/api/summary?month=${month}`)).json?.totalSpent ?? 0
      const tx = await call('POST', '/api/transactions', {
        date: `${month}-18`,
        amount: 777,
        description: 'Teste smoke - transferencia nova',
        categoryId: transfer.id,
        kind: 'expense',
      })
      const depois = (await call('GET', `/api/summary?month=${month}`)).json?.totalSpent ?? 0

      if (Math.abs(depois - antes) < 0.01) {
        ok('categoria de transferencia criada fica fora do total')
      } else {
        bad('categoria de transferencia criada fica fora do total', `${antes} -> ${depois}`)
      }
      if (tx.json?.id) await call('DELETE', `/api/transactions/${tx.json.id}`)
    }

    for (const c of criadas) await call('DELETE', `/api/categories/${c.id}`)

    const depoisDeApagar = await call('GET', '/api/categories')
    const sobrou = criadas.some((c) => depoisDeApagar.json?.some((x) => x.id === c.id))
    if (sobrou) bad('categoria removida some da listagem', 'alguma continua la')
    else ok('categoria removida some da listagem')
  }
}

// ---------------------------------------------------------------------------
console.log('\nLancamentos sem categoria')
// ---------------------------------------------------------------------------

{
  // O numero da tela inicial precisa bater com o que o filtro entrega.
  //
  // Bug real em producao: o resumo contava 'Outros' como "sem categoria" e a
  // listagem filtrava so category_id IS NULL. O app anunciava "35 lancamentos
  // sem categoria", o usuario tocava, e a tela vinha vazia. Duas definicoes da
  // mesma regra, uma so corrigida.
  const resumo = await call('GET', `/api/summary?month=${month}`)
  const contados = resumo.json?.uncategorizedCount ?? 0

  const filtrados = await call('GET', `/api/transactions?month=${month}&uncategorized=1`)
  const devolvidos = filtrados.json?.total ?? 0

  if (filtrados.status !== 200) {
    bad('GET /transactions?uncategorized=1', `status ${filtrados.status}`)
  } else if (contados === devolvidos) {
    ok('contador e filtro de "sem categoria" concordam', `${contados} lançamento(s)`)
  } else {
    bad(
      'contador e filtro de "sem categoria" concordam',
      `resumo diz ${contados}, filtro devolve ${devolvidos}`,
    )
  }

  // Um lancamento em 'Outros' TEM de entrar: e o balde de fallback do
  // categorizador, e e justamente o que espera decisao do usuario.
  const outrosId = (await call('GET', '/api/categories')).json?.find(
    (x) => x.name === 'Outros',
  )?.id

  if (!outrosId) {
    bad('categoria Outros disponivel', 'nao encontrada no seed')
  } else {
    const novo = await call('POST', '/api/transactions', {
      date: `${month}-17`,
      amount: 42.42,
      description: 'Teste smoke - sem classificar',
      categoryId: outrosId,
      kind: 'expense',
    })

    if (novo.status !== 200 && novo.status !== 201) {
      bad('POST /transactions (Outros)', `status ${novo.status}`)
    } else {
      const depois = await call('GET', `/api/transactions?month=${month}&uncategorized=1`)
      const achou = depois.json?.items?.some((t) => t.id === novo.json?.id)
      if (achou) ok('lançamento em "Outros" aparece no filtro')
      else bad('lançamento em "Outros" aparece no filtro', 'nao veio na lista')

      if (novo.json?.id) await call('DELETE', `/api/transactions/${novo.json.id}`)
    }
  }
}

// ---------------------------------------------------------------------------
console.log('\nAuditoria de categoria')
// ---------------------------------------------------------------------------

{
  // O que o total do mes esconde precisa continuar VISIVEL em algum lugar.
  //
  // Tirar transferencia do total foi correto, mas levou junto a unica forma de
  // enxergar aquele dinheiro: pagamento de fatura e aplicacao sumiram de todas
  // as telas de analise. Estas checagens garantem que a lista e os totais por
  // categoria continuam mostrando o valor cheio, com a exclusao explicada.
  const cats = await call('GET', '/api/categories')
  const transferId = cats.json?.find((c) => c.name === 'Transferencias')?.id
  const mercadoId2 = cats.json?.find((c) => c.name === 'Mercado')?.id

  if (!transferId || !mercadoId2) {
    bad('categorias do seed disponiveis', 'Transferencias ou Mercado ausente')
  } else {
    // Uma saida normal e uma transferencia, no mesmo mes.
    const gasto = await call('POST', '/api/transactions', {
      date: `${month}-19`,
      amount: 250,
      description: 'Teste smoke - compra normal',
      categoryId: mercadoId2,
      kind: 'expense',
    })
    const transf = await call('POST', '/api/transactions', {
      date: `${month}-19`,
      amount: 1800,
      description: 'Teste smoke - pagamento de fatura',
      categoryId: transferId,
      kind: 'expense',
    })

    // 1. A listagem filtrada pela transferencia PRECISA trazer o lancamento.
    const lista = await call('GET', `/api/transactions?month=${month}&categoryId=${transferId}`)
    const achou = lista.json?.items?.some((t) => t.id === transf.json?.id)
    if (achou) ok('lancamento fora do total aparece ao filtrar pela categoria')
    else bad('lancamento fora do total aparece ao filtrar pela categoria', 'nao veio')

    // 2. Os totais precisam separar o que conta do que nao conta.
    const t = lista.json?.totals
    const faltando = hasKeys(t, ['spent', 'income', 'outOfMonthTotal', 'outOfMonthCount'])
    if (faltando) {
      bad('contrato de TransactionTotals', faltando)
    } else if (t.spent >= 1800 && t.outOfMonthTotal >= 1800) {
      ok('totais mostram o valor cheio E o quanto fica fora', `R$ ${t.outOfMonthTotal}`)
    } else {
      bad(
        'totais mostram o valor cheio E o quanto fica fora',
        `spent=${t.spent} fora=${t.outOfMonthTotal}`,
      )
    }

    // 3. A categoria normal nao pode ter nada "fora do total".
    const listaNormal = await call(
      'GET',
      `/api/transactions?month=${month}&categoryId=${mercadoId2}`,
    )
    if ((listaNormal.json?.totals?.outOfMonthTotal ?? -1) === 0) {
      ok('categoria comum nao reporta exclusao')
    } else {
      bad('categoria comum nao reporta exclusao', `fora=${listaNormal.json?.totals?.outOfMonthTotal}`)
    }

    // 4. O espelho do detalhamento traz a transferencia...
    const fora = await call('GET', `/api/breakdown?month=${month}&scope=out`)
    const temTransf = Array.isArray(fora.json)
      ? fora.json.some((b) => b.categoryName === 'Transferencias')
      : false
    if (temTransf) ok('breakdown?scope=out lista a transferencia')
    else bad('breakdown?scope=out lista a transferencia', 'nao veio')

    // 5. ...e o detalhamento normal continua SEM ela.
    const dentro = await call('GET', `/api/breakdown?month=${month}`)
    const vazou = Array.isArray(dentro.json)
      ? dentro.json.some((b) => b.categoryName === 'Transferencias')
      : false
    if (vazou) bad('os dois escopos nao se misturam', 'transferencia vazou para o detalhamento')
    else ok('os dois escopos nao se misturam')

    if (gasto.json?.id) await call('DELETE', `/api/transactions/${gasto.json.id}`)
    if (transf.json?.id) await call('DELETE', `/api/transactions/${transf.json.id}`)
  }
}

// ---------------------------------------------------------------------------
console.log('\nNotificacoes')
// ---------------------------------------------------------------------------

{
  // Endpoint em .invalid de proposito: e um TLD reservado que nunca resolve,
  // entao o envio falha por REDE. Um endpoint real responderia 404 e o codigo
  // apagaria a inscricao - o que e correto em producao, mas aqui esconderia a
  // checagem que importa: falha de rede nao pode desinscrever o aparelho.
  const endpoint = `https://push.invalid/smoke-${RUN}`
  const keys = { p256dh: `B${'a'.repeat(85)}Q`, auth: 'c'.repeat(22) }

  const before = await call('GET', '/api/push/status')
  const missing = hasKeys(before.json, ['configured', 'publicKey', 'devices'])
  if (before.status === 200 && !missing) {
    ok('GET /push/status', `configurado=${before.json.configured}`)
  } else {
    bad('GET /push/status', missing ?? `status ${before.status}`)
  }

  if (!before.json?.configured) {
    // Sem VAPID no .dev.vars o resto nao tem como passar. Melhor dizer isso do
    // que despejar cinco falhas que nao sao defeito do codigo.
    ok('push sem chaves VAPID degrada', 'defina VAPID_* no .dev.vars para testar o resto')
  } else {
    const key = before.json.publicKey ?? ''
    if (key.length === 87 && key.startsWith('B')) {
      ok('chave publica VAPID no formato certo', '65 bytes em base64url')
    } else {
      bad('chave publica VAPID no formato certo', `${key.length} chars`)
    }

    const devicesBefore = before.json.devices

    const sub = await call('POST', '/api/push/subscribe', { endpoint, keys })
    if (sub.status === 200 && sub.json?.ok) ok('POST /push/subscribe')
    else bad('POST /push/subscribe', `status ${sub.status} ${sub.text.slice(0, 160)}`)

    const after = await call('GET', '/api/push/status')
    if (after.json?.devices === devicesBefore + 1) {
      ok('aparelho contabilizado', `${after.json.devices} inscrito(s)`)
    } else {
      bad('aparelho contabilizado', `${devicesBefore} -> ${after.json?.devices}`)
    }

    // O mesmo aparelho reinscrito devolve o MESMO endpoint. Duas linhas aqui
    // fariam o iPhone receber cada alerta em duplicata.
    await call('POST', '/api/push/subscribe', { endpoint, keys })
    const again = await call('GET', '/api/push/status')
    if (again.json?.devices === devicesBefore + 1) {
      ok('reinscrever o mesmo aparelho nao duplica')
    } else {
      bad('reinscrever o mesmo aparelho nao duplica', `devices=${again.json?.devices}`)
    }

    const insecure = await call('POST', '/api/push/subscribe', {
      endpoint: 'http://push.invalid/x',
      keys,
    })
    if (insecure.status === 400) ok('endpoint sem HTTPS e recusado')
    else bad('endpoint sem HTTPS e recusado', `status ${insecure.status}`)

    const badKey = await call('POST', '/api/push/subscribe', {
      endpoint,
      keys: { p256dh: 'curta+demais/', auth: 'x' },
    })
    if (badKey.status === 400) ok('chave malformada e recusada')
    else bad('chave malformada e recusada', `status ${badKey.status}`)

    const test = await call('POST', '/api/push/test')
    const testMissing = hasKeys(test.json, ['sent', 'removed', 'failed'])
    if (test.status === 200 && !testMissing) {
      ok('POST /push/test responde o contrato', `falhas=${test.json.failed}`)
    } else {
      bad('POST /push/test', testMissing ?? `status ${test.status}`)
    }

    // A garantia que importa: um envio que falhou por rede NAO pode apagar a
    // inscricao. So 404/410 do servico de push justificam remover.
    if (test.json?.removed === 0) {
      ok('falha de rede nao desinscreve o aparelho')
    } else {
      bad('falha de rede nao desinscreve o aparelho', `removidos=${test.json?.removed}`)
    }

    const off = await call('POST', '/api/push/unsubscribe', { endpoint })
    const final = await call('GET', '/api/push/status')
    if (off.status === 200 && final.json?.devices === devicesBefore) {
      ok('POST /push/unsubscribe', 'contagem voltou ao inicial')
    } else {
      bad('POST /push/unsubscribe', `status ${off.status} devices=${final.json?.devices}`)
    }
  }
}

// ---------------------------------------------------------------------------
console.log('\nSessao')
// ---------------------------------------------------------------------------

{
  await call('POST', '/api/auth/logout')
  const saved = cookie
  cookie = ''
  const r = await call('GET', '/api/summary')
  if (r.status === 401) ok('logout invalida a sessao')
  else bad('logout invalida a sessao', `status ${r.status}`)
  cookie = saved
}

// ---------------------------------------------------------------------------

console.log(`\n${'-'.repeat(52)}`)
console.log(`${pass} passaram, ${fail} falharam`)
if (fail) {
  console.log('\nFalhas:')
  for (const f of failures) console.log(`  - ${f}`)
  // exitCode em vez de process.exit(): no Windows, encerrar a forca com
  // conexoes de fetch ainda abertas dispara um assert do libuv e o processo
  // sai com 127 no lugar de 1 - justamente na falha, que e quando o codigo
  // de saida importa para quem chamou.
  process.exitCode = 1
} else {
  console.log('\nTudo certo.\n')
}
