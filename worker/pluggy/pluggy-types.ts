/**
 * Formato BRUTO da API do Pluggy.
 *
 * Estes tipos descrevem o que chega no fio, antes de qualquer normalizacao:
 * data em UTC, sinal invertido em conta de cartao, campos que o plano gratuito
 * nao preenche. Os tipos de dominio vivem em @shared/types e nao devem ser
 * misturados com estes - a traducao de um para o outro acontece em sync.ts, em
 * um unico lugar.
 *
 * Campos opcionais/anulaveis aqui nao sao pessimismo gratuito: o Pluggy omite
 * boa parte deles conforme o conector e o plano, e um `undefined` inesperado no
 * meio do sync custa a execucao inteira.
 */

/**
 * Statuses conhecidos do item. A uniao com `string` mantem o autocomplete sem
 * quebrar a tipagem quando o Pluggy introduzir um status novo.
 */
export type PluggyItemStatus =
  | 'UPDATED'
  | 'LOGIN_ERROR'
  | 'OUTDATED'
  | 'WAITING_USER_INPUT'
  | (string & {})

export type PluggyAccountType = 'BANK' | 'CREDIT'

export type PluggyTransactionType = 'DEBIT' | 'CREDIT'

export type PluggyTransactionStatus = 'POSTED' | 'PENDING'

/** POST /auth -> a apiKey e um JWT de 2h, enviado no header X-API-KEY. */
export interface PluggyAuthResponse {
  apiKey: string
}

export interface PluggyItemError {
  code?: string | null
  message?: string | null
}

/** GET /items/{id} */
export interface PluggyItem {
  id: string
  status: PluggyItemStatus
  /** Preenchido quando o status indica problema de conexao. */
  error?: PluggyItemError | null
}

/** GET /accounts?itemId={itemId} */
export interface PluggyAccount {
  id: string
  type: PluggyAccountType
  subtype?: string | null
  name: string
  number?: string | null
  balance?: number | null
  currencyCode?: string | null
}

export interface PluggyAccountsResponse {
  results: PluggyAccount[]
}

export interface PluggyMerchant {
  name?: string | null
  businessName?: string | null
  cnpj?: string | null
  category?: string | null
}

export interface PluggyTransaction {
  id: string
  description: string | null
  descriptionRaw?: string | null
  /**
   * ATENCAO: em conta BANK o sinal ja e o natural (negativo = saida), mas em
   * conta CREDIT o Pluggy usa a convencao invertida (positivo = despesa).
   */
  amount: number
  /** ISO8601 em UTC. Nunca use direto: passe por utcToBrtDate. */
  date: string
  /** Exige plano Pro; no plano gratuito costuma vir nulo. */
  category?: string | null
  categoryId?: string | null
  type?: PluggyTransactionType
  status?: PluggyTransactionStatus
  currencyCode?: string | null
  balance?: number | null
  merchant?: PluggyMerchant | null
  /** Formatos nao usados pelo app; ficam opacos de proposito. */
  paymentData?: Record<string, unknown> | null
  creditCardMetadata?: Record<string, unknown> | null
}

/**
 * GET /v2/transactions - paginacao por CURSOR.
 * `next` alimenta o parametro `after` da proxima chamada; null na ultima pagina.
 */
export interface PluggyTransactionPage {
  results: PluggyTransaction[]
  next: string | null
}
