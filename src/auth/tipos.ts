export type Papel = 'administrador' | 'convidado';

/**
 * Uma chave por seção liberável da tela ao papel "convidado" — o
 * "administrador" ignora isto e tem acesso total sempre (ver `middleware.ts`).
 * Tudo começa `false` num usuário novo (opt-in, nunca opt-out).
 */
export interface Permissoes {
  consultaPedidos: boolean;
  consultaOrcamentos: boolean;
  relatorioVendas: boolean;
  relatorioOrcamentos: boolean;
  relatorioComissionamento: boolean;
  /** Módulo de Fretes (Fase 1, 2026-09-15) — cotação/transportadoras/propostas/fechamento. Chave nova, aditiva: usuários existentes simplesmente começam com `false` (opt-in). */
  fretes: boolean;
  /** Fase 4A.6 — "LOGISTICA_APROVA": triagem de propostas na Central da Logística (liberar/descartar). */
  fretesLogistica: boolean;
  /** Fase 4A.6 — "COMERCIAL_APROVA": Central do Vendedor (negociar/escolher o frete vencedor). */
  fretesComercial: boolean;
  /** Fase 4A.6 — "APROVA_EM_SUBSTITUICAO": permite escolher o frete em nome de outro vendedor, sempre com motivo registrado. */
  fretesSubstituicao: boolean;
  /** Fase 4A.6 — "GERENCIA": visão ampliada na Central do Vendedor (vê propostas de todos os vendedores, não só as próprias). */
  fretesGerencia: boolean;
}

export const PERMISSOES_VAZIAS: Permissoes = {
  consultaPedidos: false,
  consultaOrcamentos: false,
  relatorioVendas: false,
  relatorioOrcamentos: false,
  relatorioComissionamento: false,
  fretes: false,
  fretesLogistica: false,
  fretesComercial: false,
  fretesSubstituicao: false,
  fretesGerencia: false,
};

export interface Usuario {
  id: string;
  usuario: string;
  nome: string;
  papel: Papel;
  senhaHash: string;
  /** Presente mesmo para administrador (nunca consultado nesse caso) — evita um tipo condicional só para exibir na UI. */
  permissoes: Permissoes;
  /**
   * true quando a senha atual foi definida por OUTRA pessoa (seed inicial do
   * primeiro admin, ou um administrador criando a conta/redefinindo a senha)
   * — nunca pela própria pessoa. Nesse estado, o login funciona normalmente,
   * mas o frontend força a troca de senha antes de liberar o resto do app
   * (regra de 2026-09-11: "após 1 acesso, solicitar que cada usuário cadastre
   * a própria senha"). Vira `false` só quando o próprio usuário define a
   * senha via `POST /api/auth/definir-senha`.
   */
  senhaProvisoria: boolean;
  /**
   * "Administrador master" (regra de 2026-09-11: só Ricardo e Wendell) — só
   * quem tem `mestre: true` pode redefinir a senha de outra pessoa (recurso
   * de recuperação de acesso). Um administrador comum (`mestre: false`)
   * continua com acesso total ao resto do app, só não pode destravar a conta
   * de alguém que perdeu a senha. Nunca consultado para `papel: 'convidado'`.
   */
  mestre: boolean;
  /**
   * Fase 4A.6 — vínculo opcional entre este login e um código de vendedor na Omie (o mesmo
   * código gravado em `CotacaoFrete.vendedorOmieId` no momento da importação). Só define
   * quem é "o vendedor responsável" para a Central do Vendedor (seção 4: cada vendedor só vê
   * fretes das próprias cotações) — nunca sincronizado com a Omie, nunca escreve lá, definido
   * manualmente pelo administrador ao cadastrar/editar a conta. `null` = sem vínculo (conta
   * de logística/gerência/administração, ou vendedor ainda não configurado).
   */
  vendedorOmieId: number | null;
}

/** `Usuario` sem `senhaHash` — nunca devolver o hash pela API, mesmo para o próprio admin. */
export type UsuarioPublico = Omit<Usuario, 'senhaHash'>;

export function paraPublico(usuario: Usuario): UsuarioPublico {
  const { senhaHash: _senhaHash, ...publico } = usuario;
  return publico;
}
