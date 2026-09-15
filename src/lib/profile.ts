/**
 * Quem está usando o app.
 *
 * É uma constante, e não um registro no banco, porque o MaBills é de um único
 * dono por instalação: o PIN é um só, não existe cadastro nem convite. Guardar
 * isto em `settings` exigiria rota, hook e tela de edição para um dado que muda
 * uma vez na vida — complexidade sem retorno.
 *
 * Para trocar, edite a linha abaixo e rode `npm run deploy`.
 */
export const OWNER_NAME = 'Caio'

/** Inicial do avatar. Um caractere: duas já não cabem bem num círculo de 40px. */
export const OWNER_INITIAL = OWNER_NAME.trim().charAt(0).toUpperCase()

/**
 * Saudação pelo horário de Brasília.
 *
 * O app inteiro raciocina em BRT (o banco grava a data já convertida), então a
 * saudação segue a mesma regra — senão, quem abrisse o app às 23h de Brasília
 * viajando pela Europa leria "bom dia".
 */
export function greeting(now: Date = new Date()): string {
  const brtHour = new Date(now.getTime() - 3 * 3600_000).getUTCHours()
  if (brtHour < 5) return 'Boa madrugada'
  if (brtHour < 12) return 'Bom dia'
  if (brtHour < 18) return 'Boa tarde'
  return 'Boa noite'
}
