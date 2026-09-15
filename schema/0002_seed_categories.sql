-- ---------------------------------------------------------------------------
-- Categorias padrao.
--
-- Sao 8 categorias de despesa porque esse e o teto da paleta categorica
-- validada (8 slots). Acima disso as cores deixam de ser distinguiveis sob
-- daltonismo. "Outros", "Transferencias" e "Renda" usam o neutro (slot 0)
-- porque nao competem por identidade visual nos graficos.
--
-- O usuario pode criar mais categorias pelo app; elas reaproveitam os mesmos
-- 8 slots, e os graficos sempre dobram a cauda em "Outros".
-- ---------------------------------------------------------------------------

INSERT OR IGNORE INTO categories (name, kind, color_slot, icon, sort_order, is_system) VALUES
  ('Mercado',              'expense',  1, 'shopping-cart', 10,  0),
  ('Restaurante/Delivery', 'expense',  2, 'utensils',      20,  0),
  ('Transporte',           'expense',  3, 'car',           30,  0),
  ('Moradia',              'expense',  4, 'home',          40,  0),
  ('Contas & Assinaturas', 'expense',  5, 'file-text',     50,  0),
  ('Saude',                'expense',  6, 'heart',         60,  0),
  ('Lazer',                'expense',  7, 'smile',         70,  0),
  ('Compras',              'expense',  8, 'shopping-bag',  80,  0),
  ('Outros',               'expense',  0, 'help-circle',   900, 1),
  ('Transferencias',       'transfer', 0, 'repeat',        910, 1),
  ('Renda',                'income',   0, 'trending-up',   920, 1);

-- ---------------------------------------------------------------------------
-- Regras iniciais de categorizacao.
--
-- Os padroes ja estao normalizados (minusculo, sem acento) porque e assim que o
-- motor compara - gravar com acento faria a regra nunca casar.
--
-- Um statement por regra, de proposito: o D1 rejeita cadeias longas de
-- UNION ALL ("too many terms in compound SELECT").
--
-- Sobre `priority` (menor aplica primeiro): e o que resolve sobreposicao. Ex.:
-- 'mercado livre' tem prioridade 10 e 'mercado' tem 60, entao uma compra no
-- Mercado Livre cai em Compras, nao em Mercado.
--
-- Padroes genericos demais foram deixados de fora de proposito ('extra' casaria
-- com 'extrato', 'dia' com qualquer coisa).
-- ---------------------------------------------------------------------------

-- Restaurante/Delivery
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'uber eats','contains',id,5 FROM categories WHERE name='Restaurante/Delivery';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'ifood','contains',id,10 FROM categories WHERE name='Restaurante/Delivery';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'rappi','contains',id,10 FROM categories WHERE name='Restaurante/Delivery';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'mcdonalds','contains',id,10 FROM categories WHERE name='Restaurante/Delivery';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'mc donalds','contains',id,10 FROM categories WHERE name='Restaurante/Delivery';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'burger king','contains',id,10 FROM categories WHERE name='Restaurante/Delivery';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'starbucks','contains',id,10 FROM categories WHERE name='Restaurante/Delivery';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'subway','contains',id,10 FROM categories WHERE name='Restaurante/Delivery';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'habibs','contains',id,10 FROM categories WHERE name='Restaurante/Delivery';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'outback','contains',id,10 FROM categories WHERE name='Restaurante/Delivery';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'restaurante','contains',id,50 FROM categories WHERE name='Restaurante/Delivery';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'lanchonete','contains',id,50 FROM categories WHERE name='Restaurante/Delivery';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'padaria','contains',id,50 FROM categories WHERE name='Restaurante/Delivery';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'pizzaria','contains',id,50 FROM categories WHERE name='Restaurante/Delivery';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'cafeteria','contains',id,50 FROM categories WHERE name='Restaurante/Delivery';

-- Transporte
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT '99app','contains',id,10 FROM categories WHERE name='Transporte';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT '99 tecnologia','contains',id,10 FROM categories WHERE name='Transporte';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'cabify','contains',id,10 FROM categories WHERE name='Transporte';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'buser','contains',id,10 FROM categories WHERE name='Transporte';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'uber','contains',id,20 FROM categories WHERE name='Transporte';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'sem parar','contains',id,20 FROM categories WHERE name='Transporte';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'conectcar','contains',id,20 FROM categories WHERE name='Transporte';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'bilhete unico','contains',id,20 FROM categories WHERE name='Transporte';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'localiza','contains',id,20 FROM categories WHERE name='Transporte';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'shell','contains',id,40 FROM categories WHERE name='Transporte';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'ipiranga','contains',id,40 FROM categories WHERE name='Transporte';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'petrobras','contains',id,40 FROM categories WHERE name='Transporte';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'estacionamento','contains',id,40 FROM categories WHERE name='Transporte';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'posto','contains',id,50 FROM categories WHERE name='Transporte';

-- Mercado
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'carrefour','contains',id,20 FROM categories WHERE name='Mercado';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'pao de acucar','contains',id,20 FROM categories WHERE name='Mercado';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'assai','contains',id,20 FROM categories WHERE name='Mercado';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'atacadao','contains',id,20 FROM categories WHERE name='Mercado';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'hortifruti','contains',id,20 FROM categories WHERE name='Mercado';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'sacolao','contains',id,20 FROM categories WHERE name='Mercado';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'acougue','contains',id,20 FROM categories WHERE name='Mercado';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'makro','contains',id,20 FROM categories WHERE name='Mercado';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'supermercado','contains',id,20 FROM categories WHERE name='Mercado';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'mercado','contains',id,60 FROM categories WHERE name='Mercado';

-- Moradia
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'aluguel','contains',id,10 FROM categories WHERE name='Moradia';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'condominio','contains',id,10 FROM categories WHERE name='Moradia';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'iptu','contains',id,10 FROM categories WHERE name='Moradia';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'imobiliaria','contains',id,20 FROM categories WHERE name='Moradia';

-- Contas & Assinaturas
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'netflix','contains',id,10 FROM categories WHERE name='Contas & Assinaturas';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'spotify','contains',id,10 FROM categories WHERE name='Contas & Assinaturas';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'amazon prime','contains',id,5 FROM categories WHERE name='Contas & Assinaturas';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'disney','contains',id,10 FROM categories WHERE name='Contas & Assinaturas';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'hbo','contains',id,10 FROM categories WHERE name='Contas & Assinaturas';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'youtube premium','contains',id,10 FROM categories WHERE name='Contas & Assinaturas';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'google one','contains',id,10 FROM categories WHERE name='Contas & Assinaturas';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'icloud','contains',id,10 FROM categories WHERE name='Contas & Assinaturas';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'apple.com/bill','contains',id,10 FROM categories WHERE name='Contas & Assinaturas';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'openai','contains',id,10 FROM categories WHERE name='Contas & Assinaturas';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'claude.ai','contains',id,10 FROM categories WHERE name='Contas & Assinaturas';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'anthropic','contains',id,10 FROM categories WHERE name='Contas & Assinaturas';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'oi fibra','contains',id,20 FROM categories WHERE name='Contas & Assinaturas';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'enel','contains',id,20 FROM categories WHERE name='Contas & Assinaturas';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'sabesp','contains',id,20 FROM categories WHERE name='Contas & Assinaturas';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'comgas','contains',id,20 FROM categories WHERE name='Contas & Assinaturas';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'cemig','contains',id,20 FROM categories WHERE name='Contas & Assinaturas';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'copel','contains',id,20 FROM categories WHERE name='Contas & Assinaturas';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'vivo','contains',id,30 FROM categories WHERE name='Contas & Assinaturas';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'claro','contains',id,30 FROM categories WHERE name='Contas & Assinaturas';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'telefonica','contains',id,30 FROM categories WHERE name='Contas & Assinaturas';

-- Saude
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'drogasil','contains',id,10 FROM categories WHERE name='Saude';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'droga raia','contains',id,10 FROM categories WHERE name='Saude';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'unimed','contains',id,10 FROM categories WHERE name='Saude';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'hapvida','contains',id,10 FROM categories WHERE name='Saude';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'smartfit','contains',id,10 FROM categories WHERE name='Saude';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'bio ritmo','contains',id,10 FROM categories WHERE name='Saude';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'drogaria','contains',id,20 FROM categories WHERE name='Saude';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'farmacia','contains',id,20 FROM categories WHERE name='Saude';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'amil','contains',id,20 FROM categories WHERE name='Saude';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'dentista','contains',id,30 FROM categories WHERE name='Saude';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'laboratorio','contains',id,40 FROM categories WHERE name='Saude';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'clinica','contains',id,40 FROM categories WHERE name='Saude';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'academia','contains',id,40 FROM categories WHERE name='Saude';

-- Lazer
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'cinemark','contains',id,10 FROM categories WHERE name='Lazer';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'steam','contains',id,10 FROM categories WHERE name='Lazer';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'playstation','contains',id,10 FROM categories WHERE name='Lazer';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'xbox','contains',id,10 FROM categories WHERE name='Lazer';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'nintendo','contains',id,10 FROM categories WHERE name='Lazer';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'ingresso.com','contains',id,10 FROM categories WHERE name='Lazer';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'cinema','contains',id,20 FROM categories WHERE name='Lazer';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'teatro','contains',id,30 FROM categories WHERE name='Lazer';

-- Compras
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'mercado livre','contains',id,10 FROM categories WHERE name='Compras';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'mercadolivre','contains',id,10 FROM categories WHERE name='Compras';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'shopee','contains',id,10 FROM categories WHERE name='Compras';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'aliexpress','contains',id,10 FROM categories WHERE name='Compras';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'magazine luiza','contains',id,10 FROM categories WHERE name='Compras';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'magalu','contains',id,10 FROM categories WHERE name='Compras';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'americanas','contains',id,10 FROM categories WHERE name='Compras';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'renner','contains',id,10 FROM categories WHERE name='Compras';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'riachuelo','contains',id,10 FROM categories WHERE name='Compras';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'centauro','contains',id,10 FROM categories WHERE name='Compras';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'netshoes','contains',id,10 FROM categories WHERE name='Compras';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'leroy merlin','contains',id,10 FROM categories WHERE name='Compras';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'kalunga','contains',id,10 FROM categories WHERE name='Compras';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'zara','contains',id,20 FROM categories WHERE name='Compras';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'amazon','contains',id,40 FROM categories WHERE name='Compras';

-- Transferencias (ficam fora do orcamento; ver is_ignored)
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'pagamento de fatura','contains',id,10 FROM categories WHERE name='Transferencias';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'pagamento fatura','contains',id,10 FROM categories WHERE name='Transferencias';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'aplicacao','contains',id,20 FROM categories WHERE name='Transferencias';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'resgate','contains',id,20 FROM categories WHERE name='Transferencias';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'investimento','contains',id,30 FROM categories WHERE name='Transferencias';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'transferencia','contains',id,30 FROM categories WHERE name='Transferencias';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'ted ','contains',id,30 FROM categories WHERE name='Transferencias';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'doc ','contains',id,30 FROM categories WHERE name='Transferencias';

-- Renda
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'pagamento salario','contains',id,5 FROM categories WHERE name='Renda';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'salario','contains',id,10 FROM categories WHERE name='Renda';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'pro labore','contains',id,10 FROM categories WHERE name='Renda';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'rendimento','contains',id,20 FROM categories WHERE name='Renda';
INSERT OR IGNORE INTO rules (pattern, match_type, category_id, priority) SELECT 'reembolso','contains',id,30 FROM categories WHERE name='Renda';
