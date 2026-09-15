/**
 * Hooks de dados.
 *
 * A parte que exige cuidado aqui e a invalidacao: mexer numa transacao muda o
 * resumo, o detalhamento e os orcamentos. Se a invalidacao esquecer uma dessas
 * chaves, o usuario troca a categoria de um lancamento, volta para a tela
 * inicial e ve o numero antigo - o tipo de bug que destroi a confianca no app.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query'
import type {
  Category,
  CreatePotRequest,
  Pot,
  CreateCategoryRequest,
  CreateRuleRequest,
  CreateTransactionRequest,
  Rule,
  SyncResult,
  Transaction,
  UpdateTransactionRequest,
  UpdateTransactionResponse,
  UpsertBudgetRequest,
} from '@shared/types'
import { api, ApiError, type TransactionFilters } from './api'
import { disablePush, enablePush, getPushState } from './push'

export const keys = {
  auth: ['auth'] as const,
  summary: (month: string) => ['summary', month] as const,
  breakdown: (month: string) => ['breakdown', month] as const,
  breakdownOut: (month: string) => ['breakdown', month, 'out'] as const,
  trends: (months: number) => ['trends', months] as const,
  transactions: (filters: TransactionFilters) => ['transactions', filters] as const,
  categories: ['categories'] as const,
  budgets: (month: string) => ['budgets', month] as const,
  budgetSuggestions: (month: string) => ['budgetSuggestions', month] as const,
  rules: ['rules'] as const,
  accounts: ['accounts'] as const,
  balance: ['balance'] as const,
  syncStatus: ['syncStatus'] as const,
  pushStatus: ['pushStatus'] as const,
  pushDevice: ['pushDevice'] as const,
}

/** Tudo que depende de lancamentos. Usado apos qualquer escrita em transacao. */
const MONEY_KEYS = ['summary', 'breakdown', 'trends', 'transactions', 'budgets']

function useInvalidateMoney() {
  const client = useQueryClient()
  return () => {
    for (const key of MONEY_KEYS) {
      void client.invalidateQueries({ queryKey: [key] })
    }
  }
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export function useAuth() {
  return useQuery({
    queryKey: keys.auth,
    queryFn: api.me,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
}

export function useSummary(month: string) {
  return useQuery({
    queryKey: keys.summary(month),
    queryFn: () => api.summary(month),
    // Segura o conteudo anterior durante o refetch: piscar esqueleto a cada
    // troca de mes e pior que esperar meio segundo com o dado antigo na tela.
    placeholderData: (previous) => previous,
  })
}

export function useBreakdown(month: string) {
  return useQuery({
    queryKey: keys.breakdown(month),
    queryFn: () => api.breakdown(month),
    placeholderData: (previous) => previous,
  })
}

/** Categorias que o total do mês não soma. Ver [[breakdown]] com scope=out. */
export function useBreakdownOutOfMonth(month: string) {
  return useQuery({
    queryKey: keys.breakdownOut(month),
    queryFn: () => api.breakdownOutOfMonth(month),
    placeholderData: (previous) => previous,
  })
}

export function useTrends(months = 6) {
  return useQuery({
    queryKey: keys.trends(months),
    queryFn: () => api.trends(months),
    placeholderData: (previous) => previous,
  })
}

export function useTransactions(filters: TransactionFilters) {
  return useQuery({
    queryKey: keys.transactions(filters),
    queryFn: () => api.transactions(filters),
    placeholderData: (previous) => previous,
  })
}

export function useCategories() {
  return useQuery({
    queryKey: keys.categories,
    queryFn: api.categories,
    staleTime: 10 * 60 * 1000,
  })
}

export function useBudgets(month: string) {
  return useQuery({
    queryKey: keys.budgets(month),
    queryFn: () => api.budgets(month),
    placeholderData: (previous) => previous,
  })
}

export function useBudgetSuggestions(month: string) {
  return useQuery({
    queryKey: keys.budgetSuggestions(month),
    queryFn: () => api.budgetSuggestions(month),
    staleTime: 10 * 60 * 1000,
  })
}

export function useRules() {
  return useQuery({ queryKey: keys.rules, queryFn: api.rules })
}

export function useAccounts() {
  return useQuery({ queryKey: keys.accounts, queryFn: api.accounts })
}

/** Saldo disponível, guardado e total. */
export function useBalance() {
  return useQuery({ queryKey: keys.balance, queryFn: api.balance })
}

export function useCreatePot(): UseMutationResult<Pot, ApiError, CreatePotRequest> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: api.createPot,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.balance })
      void client.invalidateQueries({ queryKey: keys.categories })
      // Virar cofrinho muda o kind para transferência, o que tira os
      // lançamentos do total do mês: o resumo precisa ser refeito.
      void client.invalidateQueries({ queryKey: ['summary'] })
      void client.invalidateQueries({ queryKey: ['breakdown'] })
    },
  })
}

export function useDeletePot(): UseMutationResult<{ ok: true }, ApiError, number> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: api.deletePot,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.balance })
      void client.invalidateQueries({ queryKey: keys.categories })
    },
  })
}

export function useSyncStatus() {
  return useQuery({ queryKey: keys.syncStatus, queryFn: api.syncStatus })
}

/** O que o SERVIDOR sabe: se ha chaves VAPID e quantos aparelhos inscritos. */
export function usePushStatus() {
  return useQuery({ queryKey: keys.pushStatus, queryFn: api.pushStatus })
}

/**
 * O que ESTE aparelho sabe. Vem do navegador, nao da API: dois iPhones do mesmo
 * usuario tem estados diferentes, e so o proprio aparelho conhece o seu.
 */
export function usePushDevice() {
  return useQuery({ queryKey: keys.pushDevice, queryFn: getPushState, staleTime: 0 })
}

export function useEnablePush(): UseMutationResult<{ ok: true }, Error, string> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (publicKey: string) => api.pushSubscribe(await enablePush(publicKey)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.pushDevice })
      void client.invalidateQueries({ queryKey: keys.pushStatus })
    },
  })
}

export function useDisablePush(): UseMutationResult<void, Error, void> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const endpoint = await disablePush()
      // Sem endpoint o aparelho ja estava fora; nao ha o que apagar no servidor.
      if (endpoint) await api.pushUnsubscribe(endpoint)
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.pushDevice })
      void client.invalidateQueries({ queryKey: keys.pushStatus })
    },
  })
}

export function useTestPush() {
  return useMutation({ mutationFn: api.pushTest })
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

export function useLogin(): UseMutationResult<{ ok: true }, ApiError, string> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (pin: string) => api.login(pin),
    onSuccess: () => {
      client.setQueryData(keys.auth, { authenticated: true })
      void client.invalidateQueries()
    },
  })
}

export function useLogout() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      client.setQueryData(keys.auth, { authenticated: false })
      client.clear()
    },
  })
}

export function useUpdateTransaction(): UseMutationResult<
  UpdateTransactionResponse,
  ApiError,
  { id: string; body: UpdateTransactionRequest }
> {
  const invalidate = useInvalidateMoney()
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }) => api.updateTransaction(id, body),
    onSuccess: () => {
      invalidate()
      // Criar regra tambem muda a lista de regras e o contador de acertos.
      void client.invalidateQueries({ queryKey: keys.rules })
    },
  })
}

export function useCreateTransaction(): UseMutationResult<
  Transaction,
  ApiError,
  CreateTransactionRequest
> {
  const invalidate = useInvalidateMoney()
  return useMutation({ mutationFn: api.createTransaction, onSuccess: invalidate })
}

export function useDeleteTransaction(): UseMutationResult<{ ok: true }, ApiError, string> {
  const invalidate = useInvalidateMoney()
  return useMutation({ mutationFn: api.deleteTransaction, onSuccess: invalidate })
}

export function useUpsertBudget(): UseMutationResult<{ ok: true }, ApiError, UpsertBudgetRequest> {
  const invalidate = useInvalidateMoney()
  return useMutation({ mutationFn: api.upsertBudget, onSuccess: invalidate })
}

export function useDeleteBudget(): UseMutationResult<
  { ok: true },
  ApiError,
  { categoryId: number; month: string }
> {
  const invalidate = useInvalidateMoney()
  return useMutation({
    mutationFn: ({ categoryId, month }) => api.deleteBudget(categoryId, month),
    onSuccess: invalidate,
  })
}

export function useRunSync(): UseMutationResult<SyncResult, ApiError, boolean | undefined> {
  const invalidate = useInvalidateMoney()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (full?: boolean) => api.runSync(full ?? false),
    onSuccess: () => {
      invalidate()
      void client.invalidateQueries({ queryKey: keys.syncStatus })
    },
  })
}

export function useCreateCategory(): UseMutationResult<Category, ApiError, CreateCategoryRequest> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: api.createCategory,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.categories })
      void client.invalidateQueries({ queryKey: ['budgets'] })
    },
  })
}

export function useDeleteCategory(): UseMutationResult<{ ok: true }, ApiError, number> {
  const client = useQueryClient()
  const invalidate = useInvalidateMoney()
  return useMutation({
    mutationFn: api.deleteCategory,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.categories })
      invalidate()
    },
  })
}

export function useCreateRule(): UseMutationResult<Rule, ApiError, CreateRuleRequest> {
  const client = useQueryClient()
  const invalidate = useInvalidateMoney()
  return useMutation({
    mutationFn: api.createRule,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.rules })
      invalidate()
    },
  })
}

export function useDeleteRule(): UseMutationResult<{ ok: true }, ApiError, number> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: api.deleteRule,
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.rules }),
  })
}
