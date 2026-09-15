-- Apaga tudo. Usado por `npm run db:reset` durante o desenvolvimento.
-- CUIDADO: nunca rode isso com --remote sem ter exportado um backup antes.
DROP TABLE IF EXISTS push_alerts;
DROP TABLE IF EXISTS push_subscriptions;
DROP TABLE IF EXISTS sync_log;
DROP TABLE IF EXISTS budgets;
DROP TABLE IF EXISTS transactions;
DROP TABLE IF EXISTS rules;
DROP TABLE IF EXISTS pluggy_category_map;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS accounts;
DROP TABLE IF EXISTS settings;
