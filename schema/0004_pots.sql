-- ---------------------------------------------------------------------------
-- MaBills - cofrinhos
--
-- Cofrinho (Itaú), caixinha (Nubank), vaquinha, reserva: o mesmo conceito com
-- nomes diferentes. Dinheiro que saiu da conta corrente mas continua sendo seu.
--
-- A decisão central: um cofrinho É UMA CATEGORIA, não uma entidade nova.
--
-- O motor de categorização já existe e já resolve o problema. "Saída APLICACAO
-- COFRINHOS" vira uma regra, e toda aplicação futura entra no cofrinho sozinha,
-- vinda do sync ou do OFX importado. Uma entidade paralela teria de duplicar
-- regras, importação e deduplicação para chegar no mesmo lugar.
--
-- O saldo sai do sinal do próprio lançamento:
--
--   "Saída APLICACAO COFRINHOS"   -1500 na conta  ->  +1500 no cofrinho
--   "Resgate COFRINHOS"           +1500 na conta  ->  -1500 no cofrinho
--
-- Ou seja: saldo = abertura + SUM(-amount). O mesmo sinal invertido que o app
-- já usa para transformar lançamento em "gasto".
--
-- Por que uma tabela à parte em vez de colunas em `categories`:
-- ALTER TABLE ADD COLUMN não é idempotente no SQLite, e `npm run db:init` roda
-- todos os arquivos de schema em sequência, inclusive sobre um banco que já
-- existe. CREATE TABLE IF NOT EXISTS pode rodar cem vezes sem quebrar nada.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pot_settings (
  -- A categoria É o cofrinho. Existir uma linha aqui é o que a torna um.
  category_id     INTEGER PRIMARY KEY REFERENCES categories(id) ON DELETE CASCADE,

  -- O que já estava guardado antes de o app enxergar o extrato.
  --
  -- É o campo que impede o erro mais perigoso desta tela: o sync só traz os
  -- últimos 35 dias, então somar apenas os lançamentos conhecidos mostraria um
  -- saldo MENOR que o real, com toda a confiança. Quem guarda dinheiro há um
  -- ano veria uma fração do que tem. Aqui a abertura é informada por quem sabe
  -- - você, olhando o app do banco - e os lançamentos ajustam a partir dali.
  opening_balance REAL NOT NULL DEFAULT 0,

  -- Data da abertura. Lançamentos ANTERIORES a ela não são somados: já estão
  -- embutidos no valor informado. Sem esse corte, reimportar um extrato antigo
  -- contaria o mesmo dinheiro duas vezes.
  opening_date    TEXT NOT NULL,

  -- Meta opcional. NULL é legítimo: reserva de emergência não tem "fim".
  goal            REAL,

  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
