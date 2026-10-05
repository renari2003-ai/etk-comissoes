/**
 * "usuario" (interno comum) e "vendedor" (comercial, vinculado via `vendedorOmieId`) foram
 * adicionados em 2026-09-28 — ambos, assim como "convidado" (preservado por compatibilidade),
 * só acessam o que estiver marcado em `permissoes`. Só "administrador" tem acesso total e é o
 * único que gerencia usuários (`exigirAdministrador`).
 */
export type Papel = 'administrador' | 'usuario' | 'vendedor' | 'convidado';

export const PAPEIS: readonly Papel[] = ['administrador', 'usuario', 'vendedor', 'convidado'];

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
  relatorioFinanceiroComissao: boolean;
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
  relatorioFinanceiroComissao: false,
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
   * LEGADO desde 2026-09-28: o vínculo operacional passou a ser `vendedorOmieNome`; este campo
   * só é considerado para papéis que não sejam "vendedor" e não tenham nome vinculado.
   */
  vendedorOmieId: number | null;
  /**
   * Vínculo operacional (2026-09-28): nome do vendedor exatamente como aparece na Omie,
   * escolhido pelo administrador numa lista vinda da própria Omie (somente leitura). Na hora
   * da consulta, o servidor converte esse nome em TODOS os códigos Omie com o mesmo nome
   * (comparação só com trim/maiúsculas-minúsculas, nunca aproximada) — ver `vinculoVendedor.ts`.
   * `null` = sem vínculo. Obrigatório para o papel "vendedor" ver qualquer dado próprio.
   */
  vendedorOmieNome: string | null;
}

/** `Usuario` sem `senhaHash` — nunca devolver o hash pela API, mesmo para o próprio admin. */
export type UsuarioPublico = Omit<Usuario, 'senhaHash'> & {
  /**
   * Códigos Omie resolvidos a partir de `vendedorOmieNome` para ESTA requisição, preenchidos
   * por `resolverVinculoVendedor` (nunca persistidos, nunca vindos do navegador). Ausente =
   * middleware não rodou; nesse caso `codigosVendedorVinculados` nunca usa o nome sem resolver.
   */
  codigosVendedorOmie?: number[];
};

export function paraPublico(usuario: Usuario): UsuarioPublico {
  const { senhaHash: _senhaHash, ...publico } = usuario;
  return publico;
}
