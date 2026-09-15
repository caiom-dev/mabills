-- ---------------------------------------------------------------------------
-- MaBills - notificacoes push
--
-- O endpoint e a chave primaria natural: o servico de push (Apple, Google)
-- devolve uma URL unica por aparelho, e reinscrever o mesmo aparelho devolve a
-- MESMA URL. Com isso, `INSERT ... ON CONFLICT DO UPDATE` deixa a inscricao
-- idempotente e um aparelho nunca recebe a mesma notificacao duas vezes.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint     TEXT PRIMARY KEY,
  -- Chave publica do aparelho (p256dh) e segredo de autenticacao (auth), ambos
  -- em base64url. Sao os dois insumos da criptografia exigida pelo RFC 8291:
  -- o payload e cifrado para ESTE aparelho, e nem o servico de push o le.
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_sent_at TEXT,
  -- Quantas tentativas seguidas falharam. Um endpoint pode morrer sem aviso
  -- (app desinstalado); ao receber 404/410 a inscricao e removida na hora.
  fail_count   INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- Controle de repeticao.
--
-- Sem isto o cron avisaria "Mercado estourou" todo santo dia ate o mes virar, e
-- um alerta que repete vira ruido que o usuario aprende a ignorar - o oposto do
-- que o app se propoe. A UNIQUE por (categoria, mes, estado) faz cada transicao
-- avisar UMA vez: uma ao entrar em atencao, outra ao estourar.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS push_alerts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  month       TEXT NOT NULL,                -- 'YYYY-MM'
  state       TEXT NOT NULL,                -- atencao | estourado
  notified_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(category_id, month, state)
);
