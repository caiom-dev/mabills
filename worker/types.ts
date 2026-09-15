/**
 * Bindings e constantes do Worker.
 */

export interface Env {
  DB: D1Database
  CACHE: KVNamespace
  ASSETS: Fetcher

  /** Secrets do Pluggy. Ausentes = app funciona so com import/manual. */
  PLUGGY_CLIENT_ID?: string
  PLUGGY_CLIENT_SECRET?: string
  /** Ids dos items do Pluggy, separados por virgula. */
  PLUGGY_ITEM_IDS?: string

  /**
   * Par VAPID das notificacoes push. Ausentes = app funciona sem notificacao,
   * exatamente como sem as credenciais do Pluggy.
   */
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  /** Contato exigido pelo VAPID ("mailto:voce@exemplo.com"). */
  VAPID_SUBJECT?: string

  /** Obrigatorios. Gere com `npm run secret` e `npm run pin`. */
  SESSION_SECRET: string
  APP_PIN_HASH: string

  TZ_OFFSET_HOURS?: string
}

/**
 * Custo de derivacao do PIN.
 *
 * O plano gratuito do Workers da 10ms de CPU por invocacao. Medido neste
 * projeto: 100k iteracoes de PBKDF2-SHA256 custam ~10,7ms e ESTOURAM o limite -
 * o login simplesmente falharia. 25k custam ~2,9ms e deixam folga confortavel
 * para o resto da requisicao.
 *
 * O que realmente protege aqui e o limite de tentativas por IP, nao o custo de
 * derivacao: o ataque viavel contra um app pessoal e alguem que descobriu a URL
 * e chuta o PIN online. Um ataque offline exigiria vazar APP_PIN_HASH, que e um
 * secret do Cloudflare - quem o obtem ja tem acesso ao banco de qualquer forma.
 *
 * Formato armazenado em APP_PIN_HASH: "<salt_hex>:<hash_hex>", com salt
 * aleatorio de 16 bytes gerado por instalacao (`npm run pin`).
 */
export const PBKDF2_ITERATIONS = 25_000

/** Sessao valida por 30 dias. */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30
export const SESSION_COOKIE = 'mabills_session'

/** Tentativas de PIN antes do bloqueio, e duracao do bloqueio. */
export const LOGIN_MAX_ATTEMPTS = 5
export const LOGIN_LOCKOUT_SECONDS = 15 * 60

/** apiKey do Pluggy vale 2h; renovamos com folga. */
export const PLUGGY_TOKEN_TTL_SECONDS = 100 * 60
export const PLUGGY_TOKEN_KEY = 'pluggy:apikey'
export const PLUGGY_BASE_URL = 'https://api.pluggy.ai'

/**
 * O plano gratuito permite 50 subrequests por invocacao. O sync gasta 1 no
 * auth, 2 por item e 1 por pagina de transacoes. Paramos em 40 e gravamos o
 * progresso, para a proxima execucao continuar de onde parou em vez de a
 * requisicao inteira ser abortada pela plataforma.
 */
export const SUBREQUEST_BUDGET = 40

/** Janela padrao de sincronizacao incremental, em dias. */
export const SYNC_WINDOW_DAYS = 35

/** Limiares do medidor de orcamento. */
export const BUDGET_WARN_THRESHOLD = 0.8

/**
 * Quanto tempo o servico de push guarda a mensagem se o iPhone estiver
 * desligado. Um dia: passar disso, o aviso ja perdeu a utilidade - o cron
 * roda de novo na manha seguinte com o numero atualizado.
 */
export const PUSH_TTL_SECONDS = 60 * 60 * 24

/**
 * Teto de aparelhos por envio. Cada um custa uma subrequest, e o envio roda
 * DEPOIS do sync, que ja consumiu parte do orcamento de 50 da invocacao.
 */
export const PUSH_MAX_ENDPOINTS = 10

/** Validade do JWT do VAPID. O maximo aceito pelos servicos de push e 24h. */
export const VAPID_JWT_TTL_SECONDS = 12 * 60 * 60
