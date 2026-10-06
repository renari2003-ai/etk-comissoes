/**
 * Reaproveitamento de cadastros (produto e cliente) DENTRO de uma única geração de relatório
 * (medição de 2026-10-06: o Comissionamento consultava o cache Postgres 465 vezes para ~70 produtos
 * e 188 vezes para os clientes — cada leitura é uma ida ao banco). O mesmo produto/cliente pedido de
 * novo na mesma geração reaproveita a primeira resposta (ou a busca ainda em andamento).
 *
 * Não muda TTL nem conteúdo do cache: a primeira consulta de cada código continua passando por
 * `ClienteOmie` (cache Postgres + Omie) normalmente. O memo morre com a geração — nunca vale entre
 * relatórios nem entre usuários. Falha não é memorizada (a próxima chamada tenta de novo, como antes).
 * Todos os demais métodos chegam intactos ao cliente original (`this` preservado).
 */
export function memorizarCadastrosDaGeracao<
  T extends { consultarProduto(codigo: number): Promise<unknown>; consultarCliente(codigo: number): Promise<unknown> },
>(cliente: T): T {
  const produtos = new Map<number, ReturnType<T['consultarProduto']>>();
  const clientes = new Map<number, ReturnType<T['consultarCliente']>>();

  function memorizar<P extends Promise<unknown>>(mapa: Map<number, P>, codigo: number, buscar: () => P): P {
    const existente = mapa.get(codigo);
    if (existente !== undefined) return existente;
    const promessa = buscar();
    mapa.set(codigo, promessa);
    promessa.catch(() => mapa.delete(codigo));
    return promessa;
  }

  const consultarProduto = (codigo: number) =>
    memorizar(produtos, codigo, () => cliente.consultarProduto(codigo) as ReturnType<T['consultarProduto']>);
  const consultarCliente = (codigo: number) =>
    memorizar(clientes, codigo, () => cliente.consultarCliente(codigo) as ReturnType<T['consultarCliente']>);

  return new Proxy(cliente, {
    get(alvo, propriedade) {
      if (propriedade === 'consultarProduto') return consultarProduto;
      if (propriedade === 'consultarCliente') return consultarCliente;
      const valor = Reflect.get(alvo, propriedade, alvo);
      return typeof valor === 'function' ? valor.bind(alvo) : valor;
    },
  });
}
