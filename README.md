# MaBills

App pessoal de controle de gastos, feito para rodar no iPhone como PWA e custar **R$ 0**.

Responde três perguntas em três segundos: **quanto já gastei este mês, em quê, e quanto ainda posso gastar sem estourar.**

---

## Por que ele é assim

| Decisão | Motivo |
|---|---|
| **PWA, não app nativo** | Xcode só existe em macOS. Sem Mac, Swift está fora. O PWA instala na tela de início com ícone próprio, abre em tela cheia, funciona offline e não expira a cada 7 dias como um build com conta Apple gratuita. |
| **Cloudflare Workers + D1** | Plano gratuito permanente. O uso projetado (~200 requisições/dia) fica duas ordens de grandeza abaixo do limite de 100 mil/dia. |
| **App e API na mesma origem** | Elimina CORS e permite cookie de sessão `SameSite=Strict`. Um único `wrangler deploy` publica tudo. |
| **PIN + cookie, não Cloudflare Access** | O Access quebra PWA no iPhone: quando o cookie expira, os `fetch()` recebem redirect cross-origin e o app fica em tela branca sem conseguir pedir login. Aqui a API responde **401 JSON** e o app mostra a tela de PIN dentro do próprio PWA. |
| **Orçamento por categoria + indicador de ritmo** | Avisar depois do estouro não muda comportamento. O app compara quanto você já gastou com quanto do mês já passou e avisa **enquanto ainda dá para corrigir**. |
| **Transferência não é gasto — mas continua visível** | Pagar a fatura do cartão, aplicar no cofrinho e mandar Pix para si mesmo movimentam a conta sem gastar nada: as compras do cartão já foram lançadas uma a uma, e o dinheiro aplicado continua sendo seu. Contá-los inflou um mês real em R$ 5 mil. Eles ficam fora do total **e** ganham uma seção própria: esconder o número resolveria a soma e criaria um buraco na auditoria. |
| **Notificação com o texto dentro, cifrada** | O padrão permite mandar um push vazio e deixar o app buscar o texto na hora da entrega — o que exigiria sessão válida e rede no exato momento. Aqui o aviso vai cifrado **para o aparelho** (RFC 8291): o serviço da Apple entrega bytes que não consegue ler, e a notificação funciona mesmo com a sessão expirada. |

---

## Requisitos

- Node.js 20+ (testado com 25)
- Conta gratuita na Cloudflare
- iPhone com iOS 16.4+ (para notificações; o resto funciona antes disso)

---

## Setup

### 1. Instalar e autenticar

```powershell
npm install
npx wrangler login
```

### 2. Criar o banco e o cache

```powershell
npx wrangler d1 create mabills
npx wrangler kv namespace create CACHE
```

Cada comando imprime um id. **Copie os dois para o `wrangler.toml`**, substituindo
`PREENCHER_APOS_D1_CREATE` e `PREENCHER_APOS_KV_CREATE`.

### 3. Criar as tabelas

```powershell
npm run db:init          # banco local, para desenvolvimento
npm run db:init:remote   # banco de produção
```

Isso cria o schema e já popula 8 categorias de despesa e cerca de 90 regras de
categorização para estabelecimentos comuns no Brasil (iFood, Uber, Carrefour,
Drogasil, Netflix…), para o app nascer categorizando a maior parte do extrato.
As tabelas das notificações entram no mesmo comando — são inertes enquanto você
não gerar as chaves.

### 4. Definir os segredos

```powershell
npm run secret    # gera o SESSION_SECRET
npm run pin       # pede o PIN e gera o APP_PIN_HASH
```

Cada um imprime um valor e o comando para gravá-lo:

```powershell
npx wrangler secret put SESSION_SECRET
npx wrangler secret put APP_PIN_HASH
```

> O PIN aceita frase, não só números. Seis dígitos são apenas 1 milhão de
> combinações — o que realmente protege é o bloqueio após 5 tentativas erradas,
> que já vem ativo.

Para rodar local, copie `.dev.vars.example` para `.dev.vars` e cole os mesmos valores.

### 5. Rodar

```powershell
npm run dev
```

Front em `http://localhost:5173`, API em `http://localhost:8787`. O Vite repassa
`/api` para o Worker automaticamente.

---

## Conectar o banco (opcional)

**O app funciona sem isso** — importando extrato OFX/CSV e com lançamento manual.
A integração apenas automatiza a entrada de dados.

O caminho gratuito é o **Meu Pluggy + Conector 200**: gratuito por tempo
indeterminado, sem CNPJ, desde que todas as contas sejam suas e nominais. Só vira
pago se o app for comercializado.

1. Cadastre-se em **[meu.pluggy.ai](https://meu.pluggy.ai)** → "Conectar Minha Conta" → adicione cada banco.
2. Cadastre-se em **[dashboard.pluggy.ai](https://dashboard.pluggy.ai)** → crie uma aplicação.
3. No Dashboard, selecione o conector **MeuPluggy** e autorize — **uma vez para cada banco** conectado.
4. Anote o `clientId` e o `clientSecret` da aplicação.

Falta o `itemId` de cada conexão — e é o passo que o Pluggy não facilita: a
documentação deles diz que **listar conexões não é oferecido** e que guardar os
ids é responsabilidade de quem integra. Para não ter que caçar:

```powershell
npm run pluggy:items
```

Ele autentica com as suas credenciais e tenta o `GET /v2/items`. Esse endpoint
vem **desligado por padrão**; quando estiver fechado, o script diz onde olhar no
Dashboard (**Dados Financeiros**) em vez de falhar em silêncio. Com os ids em
mãos, confira antes de gravar:

```powershell
npm run pluggy:items -- <id1> <id2>
```

Ele mostra o banco e as contas de cada id, avisa qual precisa ser reconectado, e
imprime o valor pronto para o `PLUGGY_ITEM_IDS`.

```powershell
npx wrangler secret put PLUGGY_CLIENT_ID
npx wrangler secret put PLUGGY_CLIENT_SECRET
npx wrangler secret put PLUGGY_ITEM_IDS     # separados por vírgula
```

> Faça os quatro passos de uma vez. Há relatos de que o conector precisa ser
> configurado durante o trial ativo do Dashboard; depois continua funcionando,
> mas não fica editável.

O Meu Pluggy atualiza os dados **uma vez por dia**, então o cron roda às 06:00
(horário de Brasília) e não adianta sincronizar de hora em hora.

---

## Ativar as notificações (opcional)

**O app funciona sem isso.** As notificações só acrescentam o aviso que chega
sem você abrir o app.

O que é enviado: um aviso quando uma categoria passa de **80% do teto**, e outro
se ela **estourar**. No máximo dois por categoria a cada mês — um alerta que
repete todo dia vira ruído que você aprende a ignorar, e aí não serve mais para
nada quando importa.

```powershell
npm run vapid
```

O comando imprime duas chaves e os comandos para gravá-las:

```powershell
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT     # mailto:voce@exemplo.com
```

Depois: **Ajustes → Alertas de gasto → Ativar notificações**, e confirme no
aviso do iOS. O botão **Enviar notificação de teste** existe porque push é a
única parte do app que você não consegue conferir sozinho — ou o iPhone apita,
ou algo falhou em silêncio no meio do caminho.

> **No iPhone, notificações só funcionam com o app na tela de início.** Aberto
> como aba no Safari, o `PushManager` sequer existe e o botão nem aparece — a
> tela mostra o que fazer em vez de dizer "não suportado".

Trocar o par de chaves desliga as notificações de **todos** os aparelhos já
inscritos; cada um precisa autorizar de novo.

---

## Publicar e instalar no iPhone

```powershell
npm run deploy
```

O comando imprime a URL (`https://mabills.<seu-subdominio>.workers.dev`).

No iPhone, **abra a URL no Safari** (o Chrome no iOS não instala PWA) →
botão Compartilhar → **Adicionar à Tela de Início**.

Confira que deu certo:
- ícone próprio na tela de início;
- abre **sem a barra de endereço**;
- em **modo avião**, ainda mostra os últimos dados.

---

## Uso diário

- **Resumo** — quanto ainda pode gastar, ritmo do mês, categorias em alerta.
- **Categorias** — lista ordenada pelo que está mais perto de estourar.
- **Transações** — busca, filtro e edição de categoria.
- **Orçamentos** — teto por categoria, com sugestão pela média dos 3 meses anteriores.
- **Alertas** — se as notificações estiverem ativas, o aviso chega sozinho ao passar de 80% do teto e ao estourar.
- **Saldo** — quanto há na conta, quanto está guardado em cofrinhos e o total.

**Auditar uma categoria.** Em *Lançamentos*, o botão **Categoria** filtra a lista
por qualquer categoria — inclusive as que não entram no total do mês. O painel no
topo separa as duas coisas:

```
Saiu da conta            R$ 2.050,00
Fora do total do mês (3)  − R$ 1.800,00
Conta como gasto           R$   250,00
```

É a resposta para "somei os lançamentos na mão e não bate com a tela inicial":
não bate mesmo, e essa linha diz exatamente por quê.

Em *Categorias*, a seção **Fora do total do mês** lista essas categorias com o
valor de cada uma. Tocar em qualquer linha abre os lançamentos dela.

**O atalho que mais importa:** ao trocar a categoria de um lançamento, marque
*"aplicar a todos os lançamentos de X"*. Isso cria uma regra permanente e
recategoriza o histórico. Duas semanas fazendo isso e a categorização fica boa
sozinha.

Um teto definido vale como **padrão para todos os meses**. Use *"só neste mês"*
quando quiser uma exceção pontual (dezembro, viagem).

**Criar categoria** está em três lugares, porque a necessidade aparece em três
momentos: o botão **+** em *Categorias*, o chip **+ Nova** na hora de classificar
um lançamento (que já deixa a nova categoria escolhida), e *Ajustes*.

O **tipo** importa mais do que parece:

| Tipo | Efeito |
|---|---|
| **Despesa** | entra no total gasto e aceita teto |
| **Receita** | entra como entrada do mês |
| **Transferência** | fica fora do total — nem gasto, nem renda |

Use **Transferência** para pagamento de fatura, aplicação/resgate e Pix entre
contas suas. É o que impede o total do mês de contar o mesmo dinheiro duas vezes.

---

## Cofrinhos

Cofrinho (Itaú), caixinha (Nubank), reserva: dinheiro que **saiu da conta
corrente mas continua sendo seu**. No extrato ele aparece como
`Saída APLICACAO COFRINHOS` e some do saldo — o app precisa contar essa
história de volta.

**Um cofrinho é uma categoria.** Em *Ajustes → Cofrinhos*, escolha a categoria
e informe quanto já está guardado hoje. A partir daí, marcar um lançamento com
essa categoria move o dinheiro:

| No extrato | No cofrinho |
|---|---|
| `Saída APLICACAO COFRINHOS` −1.500 | **+1.500** guardados |
| `Resgate COFRINHOS` +1.500 | **−1.500** guardados |

Nada disso conta como gasto do mês — guardar não é gastar. A categoria passa
automaticamente para o tipo *Transferência* ao virar cofrinho.

Ser categoria é o que faz o resto funcionar de graça: crie uma regra para
`APLICACAO COFRINHOS` e toda aplicação futura entra no cofrinho sozinha,
venha do sync ou de um OFX importado.

A tela inicial passa a mostrar as duas respostas, que são diferentes:

```
Disponível na conta      R$    37,75     <- o que dá para gastar hoje
Guardado em cofrinhos    R$ 1.400,00
Total                    R$ 1.437,75
```

> **Por que o app pergunta quanto já está guardado.** O sync do Pluggy só traz
> os últimos 35 dias. Somar apenas os lançamentos conhecidos mostraria um saldo
> MENOR que o real para quem guarda dinheiro há mais tempo — e um número errado
> com aparência de certo é pior que número nenhum. Lançamentos anteriores à data
> de abertura não são somados de novo: já estão embutidos no valor informado.

Cartão de crédito não entra no "disponível": o saldo de uma conta de crédito é
fatura em aberto, ou seja, dívida.

---

## Importar extrato

Todo banco brasileiro exporta OFX — é o formato mais confiável, porque traz um id
estável por transação (`FITID`) e a reimportação do mesmo arquivo nunca duplica.

No app: **Ajustes → Importar extrato**. Uma tela de preview mostra
*"N novos, M duplicados"* antes de gravar qualquer coisa.

CSV também funciona (detecta `;` ou `,`, formato `DD/MM/AAAA` e vírgula decimal).
Sem `FITID`, a deduplicação usa data + valor + conta.

---

## Verificar se está funcionando

```powershell
npm run typecheck    # erros de tipo
npm run build        # build de produção
npm run test:push    # 12 checagens da criptografia das notificações

# Com `npx wrangler dev` rodando em outro terminal:
npm run smoke        # 69 checagens end-to-end na API
```

O smoke test pode rodar quantas vezes quiser contra o mesmo banco: cada execução
usa identificadores próprios. Ele cobre as garantias que quebram o app se
falharem:

- **401 responde JSON, nunca redirect** — um redirect deixaria o PWA em tela branca no iPhone
- **reimportar o mesmo extrato não duplica** — deduplicação por `FITID`
- **teto `'*'` vale para o mês corrente** — o `COALESCE` do orçamento recorrente
- **lançamento manual grava saída com sinal negativo**
- **"aplicar a todos" recategoriza o histórico**, inclusive texto com acento
- **escolha manual fica inviolável** ao sync e às regras
- **sync degrada sem credenciais do Pluggy**, em vez de dar 500
- **reinscrever o mesmo aparelho não duplica** a notificação
- **falha de rede não desinscreve** o aparelho — só 404/410 do serviço de push
- **transferência não entra no total** do mês nem no detalhamento
- **guardar no cofrinho não conta como gasto**, e aplicação soma enquanto resgate subtrai
- **lançamento anterior à abertura do cofrinho não é contado duas vezes**
- **o contador e o filtro de "sem categoria" concordam** — o número da tela inicial precisa devolver lista
- **lançamento fora do total continua visível** ao filtrar pela categoria, com a exclusão explicada
- **os dois escopos não se misturam** — o que está fora do total não vaza para o detalhamento normal

O `test:push` cobre a criptografia da notificação (RFC 8291), que é a única
parte do app cujo erro não aparece em lugar nenhum: uma derivação de chave
errada não gera 500 nem log — o serviço de push aceita os bytes, entrega ao
iPhone, e o iPhone descarta a mensagem em silêncio. O teste faz o papel do
aparelho: gera o par de chaves que o navegador geraria, manda cifrar e decifra
pelo caminho inverso.

```powershell
npx wrangler tail --format pretty                          # logs ao vivo
curl "http://127.0.0.1:8787/cdn-cgi/local/scheduled"        # dispara o cron local
```

Mais confiável que ler log: **Ajustes** mostra o último sync e quantos
lançamentos vieram. Se a data não avançou, o cron não rodou.

```powershell
npx wrangler d1 execute mabills --remote --command "SELECT * FROM sync_log ORDER BY id DESC LIMIT 5"
```

---

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| **Sync parou sozinho** | Algum item caiu em `LOGIN_ERROR` (senha trocada, MFA). Ajustes mostra faixa vermelha. Reconecte em meu.pluggy.ai. |
| **Gasto no mês errado** | Compra após 21h cai no dia seguinte em UTC. O app converte para BRT na ingestão — se aparecer, é bug de ingestão, não de exibição. |
| **Cartão com valor invertido** | No Pluggy, conta de crédito usa positivo = despesa (o oposto de conta corrente). A normalização é por `account.type`. |
| **Transferência inflando o orçamento** | Marque o lançamento como *"Ignorar no orçamento"*, ou mude a categoria dele para uma do tipo **Transferência**. Confira o resultado em *Categorias → Fora do total do mês*. |
| **"Somei na mão e não bate com a tela inicial"** | Provavelmente está certo. Filtre a categoria em *Lançamentos*: o painel mostra quanto saiu da conta e quanto disso não conta no mês. |
| **Uma categoria sumiu das telas de análise** | Categoria do tipo *Transferência* não aparece em "Por categoria" nem na composição, de propósito. Ela está em *Categorias → Fora do total do mês*. |
| **Login não entra em dev** | O cookie usa `Secure`, que o navegador recusa em `http://`. O código já detecta e omite em localhost — se persistir, use o túnel HTTPS. |
| **PWA não instala** | Precisa ser HTTPS e precisa ser o **Safari**. Para testar antes de publicar: `npx cloudflared tunnel --url http://localhost:8787`. |
| **Notificação não chega** | Na ordem: o app precisa estar na tela de início (não em aba); os três segredos `VAPID_*` precisam existir em produção; e o alerta de cada categoria sai **uma vez por mês** por estado — se já avisou, não repete. Use *Enviar notificação de teste* para separar "não configurado" de "não havia o que avisar". |
| **Notificações pararam depois de mexer nas chaves** | Trocar o par VAPID invalida todas as inscrições. Cada aparelho precisa desativar e ativar de novo em Ajustes. |

---

## Limites do plano gratuito (e como o código respeita)

| Limite | Como é tratado |
|---|---|
| **10ms de CPU por requisição** | PBKDF2 usa 25.000 iterações (~2,9ms medidos). Com 100.000 seriam ~10,7ms e **o login falharia**. |
| **50 subrequests por requisição** | O sync tem orçamento de 40, para e grava progresso parcial. A execução seguinte continua de onde parou. |
| **1.000 escritas/dia no KV** | O KV guarda só a apiKey do Pluggy (renovada a cada ~100 min) e o contador de tentativas de login. |
| **100 mil requisições/dia** | Uso real de um usuário: algumas centenas. |
| **50 subrequests por requisição** (no cron) | O envio das notificações roda depois do sync, que já gastou parte do orçamento. Por isso o limite de 10 aparelhos por envio, e um JWT do VAPID assinado uma vez por invocação em vez de um por aparelho. |

---

## Backup

Os dados são SQLite puro. Exporte quando quiser:

```powershell
npx wrangler d1 export mabills --remote --output backup.sql
```
