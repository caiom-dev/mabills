-- ---------------------------------------------------------------------------
-- MaBills - schema inicial
--
-- Principio central: o `id` de uma transacao no Pluggy e estavel, entao ele e
-- a chave primaria natural. Com INSERT ... ON CONFLICT DO UPDATE a sincronizacao
-- vira idempotente por construcao: rodar o sync 50x no mesmo periodo nao duplica
-- nada.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS accounts (
  id          TEXT PRIMARY KEY,              -- account id do Pluggy (uuid)
  item_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,                 -- BANK | CREDIT
  subtype     TEXT,
  number      TEXT,
  balance     REAL,
  currency    TEXT NOT NULL DEFAULT 'BRL',
  is_active   INTEGER NOT NULL DEFAULT 1,
  synced_at   TEXT
);

-- color_slot: 0 = neutro (cinza), 1..8 = slots da paleta categorica validada.
-- Guardar o slot em vez do hex garante que a cor sempre exista nas versoes
-- clara E escura, e impede a entrada de uma cor fora da paleta.
CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  kind        TEXT NOT NULL DEFAULT 'expense',   -- expense | income | transfer
  color_slot  INTEGER NOT NULL DEFAULT 0,
  icon        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 100,
  is_archived INTEGER NOT NULL DEFAULT 0,
  is_system   INTEGER NOT NULL DEFAULT 0        -- nao pode ser apagada
);

-- Camada 1: categoria que o Pluggy devolve -> categoria do usuario.
-- (No plano gratuito o campo `category` costuma vir nulo, entao esta camada
--  e a menos importante das tres.)
CREATE TABLE IF NOT EXISTS pluggy_category_map (
  pluggy_category TEXT PRIMARY KEY,
  category_id     INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE
);

-- Camada 2: regras por texto do estabelecimento. E o motor principal.
-- UNIQUE(pattern): o mesmo texto apontando para duas categorias e ambiguo por
-- definicao. Com isso o seed vira idempotente e recriar uma regra pelo app
-- substitui a anterior em vez de duplicar.
CREATE TABLE IF NOT EXISTS rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern     TEXT NOT NULL UNIQUE,             -- ja normalizado: minusculo, sem acento
  match_type  TEXT NOT NULL DEFAULT 'contains', -- contains | startsWith | exact
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  priority    INTEGER NOT NULL DEFAULT 100,     -- menor aplica antes
  min_amount  REAL,
  max_amount  REAL,
  hit_count   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rules_priority ON rules(priority, id);

CREATE TABLE IF NOT EXISTS transactions (
  id              TEXT PRIMARY KEY,       -- Pluggy: uuid | manual: man_* | ofx: ofx_* | csv: csv_*
  account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date            TEXT NOT NULL,          -- 'YYYY-MM-DD' JA convertido para BRT
  posted_at       TEXT,                   -- ISO8601 original (UTC), para auditoria
  amount          REAL NOT NULL,          -- NORMALIZADO: negativo = saida, positivo = entrada
  amount_raw      REAL,                   -- valor como veio da origem, para depuracao
  description     TEXT NOT NULL,
  description_raw TEXT,
  merchant_name   TEXT,
  type            TEXT NOT NULL DEFAULT 'DEBIT',   -- DEBIT | CREDIT
  status          TEXT NOT NULL DEFAULT 'POSTED',  -- POSTED | PENDING
  pluggy_category TEXT,
  category_id     INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  category_source TEXT NOT NULL DEFAULT 'none',    -- none | pluggy | rule | manual
  is_manual       INTEGER NOT NULL DEFAULT 0,
  is_ignored      INTEGER NOT NULL DEFAULT 0,      -- fora do orcamento (transferencias)
  notes           TEXT,
  dedupe_key      TEXT,                   -- date|abs(amount)|account - pega PENDING->POSTED que troca de id
  source          TEXT NOT NULL DEFAULT 'pluggy',  -- pluggy | manual | ofx | csv
  -- description + merchant_name normalizados (minusculo, sem acento).
  -- Existe porque os padroes das regras sao normalizados: sem esta coluna, um
  -- LIKE '%acougue%' nunca casaria com 'Acougue do Ze' escrito com cedilha, e o
  -- backfill em SQL erraria silenciosamente. Normalizar em JS na hora da consulta
  -- estouraria o limite de 10ms de CPU com poucos milhares de linhas.
  search_text     TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tx_date     ON transactions(date DESC);
CREATE INDEX IF NOT EXISTS idx_tx_cat_date ON transactions(category_id, date);
CREATE INDEX IF NOT EXISTS idx_tx_dedupe   ON transactions(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_tx_account  ON transactions(account_id, date DESC);

-- month = 'YYYY-MM' para um mes especifico, ou '*' para o teto recorrente padrao.
-- A consulta resolve COALESCE(mes especifico, '*'): configura-se uma vez e so
-- cria-se linha por mes quando ha sobrescrita pontual.
CREATE TABLE IF NOT EXISTS budgets (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  month        TEXT NOT NULL,
  limit_amount REAL NOT NULL,
  UNIQUE(category_id, month)
);

CREATE TABLE IF NOT EXISTS sync_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  trigger     TEXT NOT NULL,             -- cron | manual
  status      TEXT NOT NULL,             -- ok | partial | error
  inserted    INTEGER NOT NULL DEFAULT 0,
  updated     INTEGER NOT NULL DEFAULT 0,
  accounts_synced INTEGER NOT NULL DEFAULT 0,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_started ON sync_log(started_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
