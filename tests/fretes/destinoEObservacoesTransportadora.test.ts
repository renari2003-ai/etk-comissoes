import { afterEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../src/config.js';
import { montarDestinoEnviado } from '../../src/fretes/destinoEnviado.js';
import { formatarDestinoTexto } from '../../src/fretes/omieFretes.js';
import { lerDestinoEnviadoPersistido } from '../../src/fretes/solicitacoesRepositorio.js';
import { montarPayloadN8n, problemaObservacaoViaN8n } from '../../src/fretes/integracaoCotacoesServico.js';
import { montarEmailCotacao } from '../../src/fretes/email/templateCotacao.js';
import {
  LIMITE_PARAMETRO_TEMPLATE_WHATSAPP,
  montarTextoWhatsapp,
  parametroObservacoesTemplate,
  parametrosTemplateWhatsapp,
  problemaLimiteWhatsapp,
} from '../../src/fretes/whatsapp/mensagemCotacao.js';
import { canaisDisponiveis, problemaCanalPrincipal } from '../../src/fretes/canaisTransportadora.js';
import { enviarWhatsappYCloud } from '../../src/fretes/integracoes/ycloudCliente.js';
import {
  LIMITE_OBSERVACOES_TRANSPORTADORA,
  validarBooleanoOpcional,
  validarDestinoManualOpcional,
  validarObservacoesTransportadoraOpcional,
} from '../../src/fretes/validacao.js';
import { ErroValidacao } from '../../src/validacao.js';
import type { CotacaoFrete, SolicitacaoCotacao, Transportadora } from '../../src/fretes/tipos.js';

// Endereço manual completo, snapshot do destino enviado e "Observações para a transportadora" —
// só funções puras (sem banco, sem rede: nenhum envio real).

function cotacao(parcial: Partial<CotacaoFrete> = {}): CotacaoFrete {
  return {
    id: 'cot-1',
    codigo: 'FRE-2026-000001',
    origem: 'ETK — Itupeva/SP',
    cepOrigem: '13295-000',
    destino: 'Rua Omie, nº 10, Centro, Curitiba/PR',
    cepDestino: '80000-000',
    origemDestino: 'PEDIDO',
    logradouroDestino: 'Rua Omie',
    numeroDestino: '10',
    complementoDestino: null,
    bairroDestino: 'Centro',
    cidadeDestino: 'Curitiba',
    ufDestino: 'PR',
    codigoMunicipioDestino: null,
    peso: 100,
    pesoBruto: 100,
    pesoLiquido: 90,
    volumes: 3,
    especieVolumes: 'CAIXA',
    modalidade: 'CIF',
    modalidadeExecucao: 'TRANSPORTADORA',
    observacoes: null,
    valorMercadoria: 12345.67,
    custoManual: 999,
    ...parcial,
  } as CotacaoFrete;
}

function solicitacao(parcial: Partial<SolicitacaoCotacao> = {}): SolicitacaoCotacao {
  return {
    id: 'sol-1',
    cotacaoFreteId: 'cot-1',
    transportadoraId: 'tr-1',
    canal: 'EMAIL',
    codigoReferencia: 'FRE-2026-000001-abcd1234',
    emailDestino: 'cotacao@transportadora.com.br',
    emailOrigem: 'CADASTRO',
    embalagens: null,
    observacoesTransportadora: null,
    destinoEnviado: null,
    ...parcial,
  } as SolicitacaoCotacao;
}

const CNPJS = { cnpjOrigem: '11222333000181', cnpjDestino: null };

describe('endereço de destino enviado (snapshot)', () => {
  it('destino estruturado: usa TODOS os campos, inclusive complemento — nunca mistura com o texto livre', () => {
    const d = montarDestinoEnviado(
      cotacao({
        origemDestino: 'MANUAL',
        destino: 'texto antigo que não deve ser usado',
        cepDestino: '01310-100',
        logradouroDestino: 'Av. Paulista',
        numeroDestino: '1000',
        complementoDestino: 'Galpão 3',
        bairroDestino: 'Bela Vista',
        cidadeDestino: 'São Paulo',
        ufDestino: 'SP',
      }),
    );
    expect(d).toEqual({
      origem: 'MANUAL',
      cep: '01310-100',
      logradouro: 'Av. Paulista',
      numero: '1000',
      complemento: 'Galpão 3',
      bairro: 'Bela Vista',
      cidade: 'São Paulo',
      uf: 'SP',
      texto: 'Av. Paulista, nº 1000, Galpão 3, Bela Vista, São Paulo/SP',
    });
  });

  it('endereço da Omie sem intervenção continua com origem OMIE (nunca vira MANUAL sozinho)', () => {
    expect(montarDestinoEnviado(cotacao()).origem).toBe('PEDIDO');
  });

  it('texto livre (cotação manual): exatamente o texto + CEP digitados, sem completar campos', () => {
    const d = montarDestinoEnviado(
      cotacao({
        origemDestino: null,
        destino: 'Rua X, 5 - Campinas/SP',
        cepDestino: '13000-000',
        logradouroDestino: null,
        numeroDestino: null,
        bairroDestino: null,
        cidadeDestino: null,
        ufDestino: null,
      }),
    );
    expect(d).toEqual({
      origem: null,
      cep: '13000-000',
      logradouro: null,
      numero: null,
      complemento: null,
      bairro: null,
      cidade: null,
      uf: null,
      texto: 'Rua X, 5 - Campinas/SP',
    });
  });

  it('formatarDestinoTexto inclui o complemento após o número', () => {
    expect(
      formatarDestinoTexto({
        origem: 'MANUAL',
        codigoMunicipio: null,
        cep: null,
        logradouro: 'Rua A',
        numero: '1',
        complemento: 'Sala 2',
        bairro: 'B',
        cidade: 'C',
        uf: 'SP',
      }),
    ).toBe('Rua A, nº 1, Sala 2, B, C/SP');
  });

  it('snapshot persistido: lido estritamente; formato inválido falha alto', () => {
    const d = montarDestinoEnviado(cotacao());
    expect(lerDestinoEnviadoPersistido(JSON.parse(JSON.stringify(d)))).toEqual(d);
    expect(lerDestinoEnviadoPersistido(null)).toBeNull();
    expect(() => lerDestinoEnviadoPersistido({ ...d, origem: 'INVENTADA' })).toThrow(/formato inválido/);
    expect(() => lerDestinoEnviadoPersistido({ ...d, cep: 123 })).toThrow(/formato inválido/);
    expect(() => lerDestinoEnviadoPersistido([d])).toThrow(/formato inválido/);
  });
});

describe('validação do endereço manual (destinoOverride)', () => {
  it('aceita endereço completo; normaliza CEP e UF', () => {
    expect(
      validarDestinoManualOpcional({
        cep: '01310100',
        logradouro: 'Av. Paulista',
        numero: '1000',
        complemento: 'Galpão 3',
        bairro: 'Bela Vista',
        cidade: 'São Paulo',
        uf: 'sp',
      }),
    ).toEqual({
      cep: '01310-100',
      logradouro: 'Av. Paulista',
      numero: '1000',
      complemento: 'Galpão 3',
      bairro: 'Bela Vista',
      cidade: 'São Paulo',
      uf: 'SP',
    });
  });

  it('rejeita CEP/UF malformados, arrays, campos longos e endereço insuficiente — nunca "melhor esforço"', () => {
    expect(() => validarDestinoManualOpcional({ cep: '123' })).toThrow(ErroValidacao);
    expect(() => validarDestinoManualOpcional({ cep: '01310-100', uf: 'S1' })).toThrow(ErroValidacao);
    expect(() => validarDestinoManualOpcional([])).toThrow(ErroValidacao);
    expect(() => validarDestinoManualOpcional({ logradouro: 'x'.repeat(201), cidade: 'C' })).toThrow(ErroValidacao);
    expect(() => validarDestinoManualOpcional({ logradouro: 'Rua A' })).toThrow(ErroValidacao);
    expect(() => validarDestinoManualOpcional({})).toThrow(ErroValidacao);
    expect(validarDestinoManualOpcional(null)).toBeNull();
  });
});

describe('"Observações para a transportadora" — validação', () => {
  const campo = 'transportadoras[0].observacoesTransportadora';

  it('opcional: ausente/vazio/só espaços → null', () => {
    expect(validarObservacoesTransportadoraOpcional(undefined, campo)).toBeNull();
    expect(validarObservacoesTransportadoraOpcional(null, campo)).toBeNull();
    expect(validarObservacoesTransportadoraOpcional('  \r\n ', campo)).toBeNull();
  });

  it('preserva acentos e quebras de linha (CRLF/CR → LF)', () => {
    expect(validarObservacoesTransportadoraOpcional('  Doca 3 — não empilhar\r\nLigar antes ', campo)).toBe('Doca 3 — não empilhar\nLigar antes');
    expect(validarObservacoesTransportadoraOpcional('a\rb', campo)).toBe('a\nb');
  });

  it('limite de tamanho e tipo/caracteres de controle rejeitados explicitamente', () => {
    expect(validarObservacoesTransportadoraOpcional('x'.repeat(LIMITE_OBSERVACOES_TRANSPORTADORA), campo)).toHaveLength(LIMITE_OBSERVACOES_TRANSPORTADORA);
    expect(() => validarObservacoesTransportadoraOpcional('x'.repeat(LIMITE_OBSERVACOES_TRANSPORTADORA + 1), campo)).toThrow(/tamanho máximo de 900/);
    expect(() => validarObservacoesTransportadoraOpcional(123, campo)).toThrow(ErroValidacao);
    expect(() => validarObservacoesTransportadoraOpcional('abc\u0000', campo)).toThrow(/controle/);
  });

  it('confirmação do aviso da API: booleano estrito', () => {
    expect(validarBooleanoOpcional(undefined, 'x')).toBe(false);
    expect(validarBooleanoOpcional(true, 'x')).toBe(true);
    expect(() => validarBooleanoOpcional('true', 'x')).toThrow(ErroValidacao);
  });
});

describe('payload/e-mail/WhatsApp — destino e observação desta transportadora', () => {
  afterEach(() => undefined);

  it('payload usa o SNAPSHOT do destino (reenvio manda o mesmo endereço, mesmo que a cotação mude)', () => {
    const snapshot = montarDestinoEnviado(
      cotacao({ origemDestino: 'MANUAL', logradouroDestino: 'Rua Manual', numeroDestino: '7', complementoDestino: 'Fundos', cepDestino: '13000-000' }),
    );
    const cotacaoAlterada = cotacao({ destino: 'Outro destino', cepDestino: '99999-999', logradouroDestino: 'Outra rua' });
    const p = montarPayloadN8n(cotacaoAlterada, solicitacao({ destinoEnviado: snapshot }), CNPJS, null);
    expect(p.logistica.destino).toBe(snapshot.texto);
    expect(p.logistica.destino).toContain('Fundos');
    expect(p.logistica.cepDestino).toBe('13000-000');
    expect(p.versao).toBe(1);
  });

  it('solicitação antiga (sem snapshot): usa o destino atual da cotação, como antes', () => {
    const p = montarPayloadN8n(cotacao(), solicitacao({ destinoEnviado: null }), CNPJS, null);
    expect(p.logistica.destino).toBe('Rua Omie, nº 10, Centro, Curitiba/PR');
    expect(p.logistica.cepDestino).toBe('80000-000');
  });

  it('payload leva só a observação DESTA solicitação e nenhum dado comercial interno', () => {
    const p = montarPayloadN8n(cotacao(), solicitacao({ observacoesTransportadora: 'Só para esta' }), CNPJS, null);
    expect(p.logistica.observacoesTransportadora).toBe('Só para esta');
    const json = JSON.stringify(p);
    for (const proibido of ['valorMercadoria', 'custoManual', 'margem', 'markup', 'comissao', '12345.67', '999']) {
      expect(json).not.toContain(proibido);
    }
    expect(montarPayloadN8n(cotacao(), solicitacao(), CNPJS, null).logistica.observacoesTransportadora).toBeNull();
  });

  it('e-mail: seção com rótulo exato, HTML escapado e quebras preservadas; ausente quando vazia', () => {
    const comNota = montarPayloadN8n(cotacao(), solicitacao({ observacoesTransportadora: 'Doca <3> & "fundos"\nLigar antes' }), CNPJS, null);
    const { texto, html } = montarEmailCotacao(comNota);
    expect(texto).toContain('Observações para a transportadora: Doca <3> & "fundos"');
    expect(texto).toContain('Ligar antes');
    expect(html).toContain('Observações para a transportadora');
    expect(html).toContain('Doca &lt;3&gt; &amp;');
    expect(html).not.toContain('<3>');
    expect(html).toMatch(/fundos.*<br>Ligar antes/s);

    const semNota = montarEmailCotacao(montarPayloadN8n(cotacao(), solicitacao(), CNPJS, null));
    expect(semNota.texto).not.toContain('Observações para a transportadora');
    expect(semNota.html).not.toContain('Observações para a transportadora');
  });

  it('payload sem o campo (ex.: contrato antigo) não quebra o template', () => {
    const p = montarPayloadN8n(cotacao(), solicitacao(), CNPJS, null);
    delete (p.logistica as Partial<typeof p.logistica>).observacoesTransportadora;
    expect(() => montarEmailCotacao(p)).not.toThrow();
  });

  it('WhatsApp texto livre: inclui a seção com as quebras de linha', () => {
    const p = montarPayloadN8n(cotacao(), solicitacao({ canal: 'WHATSAPP', observacoesTransportadora: 'Linha 1\nLinha 2' }), CNPJS, '5511999990000');
    const texto = montarTextoWhatsapp(p);
    expect(texto).toContain('*Observações para a transportadora:* Linha 1\n   Linha 2');
  });

  it('WhatsApp template aprovado: continua com 6 parâmetros; observação vai no {{6}} com rótulo; quebras viram " | "', () => {
    const p = montarPayloadN8n(
      cotacao({ observacoes: 'Cobrar TDE' }),
      solicitacao({ canal: 'WHATSAPP', observacoesTransportadora: 'Doca 3\nLigar antes' }),
      CNPJS,
      '5511999990000',
    );
    const params = parametrosTemplateWhatsapp(p);
    expect(params).toHaveLength(6);
    expect(params[5]).toBe('Cobrar TDE | Observações para a transportadora: Doca 3 | Ligar antes');
    expect(params[2]).toContain('Rua Omie');
    // Sem observação nenhuma: "—", como antes
    expect(parametrosTemplateWhatsapp(montarPayloadN8n(cotacao(), solicitacao({ canal: 'WHATSAPP' }), CNPJS, '5511999990000'))[5]).toBe('—');
  });

  it('WhatsApp template: observação máxima (900) cabe no {{6}}; acima de 1024 no total → erro explícito, nunca corte silencioso', () => {
    expect(parametroObservacoesTemplate(undefined, 'x'.repeat(LIMITE_OBSERVACOES_TRANSPORTADORA))).not.toBeNull();
    expect(parametroObservacoesTemplate(undefined, 'x'.repeat(LIMITE_OBSERVACOES_TRANSPORTADORA))!.length).toBeLessThanOrEqual(LIMITE_PARAMETRO_TEMPLATE_WHATSAPP);
    expect(parametroObservacoesTemplate('y'.repeat(200), 'x'.repeat(LIMITE_OBSERVACOES_TRANSPORTADORA))).toBeNull();
    const p = montarPayloadN8n(
      cotacao({ observacoes: 'y'.repeat(200) }),
      solicitacao({ canal: 'WHATSAPP', observacoesTransportadora: 'x'.repeat(LIMITE_OBSERVACOES_TRANSPORTADORA) }),
      CNPJS,
      '5511999990000',
    );
    expect(() => parametrosTemplateWhatsapp(p)).toThrow(/excedem o limite de 1024/);
  });
});

describe('canal principal editável — validação do cadastro', () => {
  const credenciais = { cnpj: config.braspressCnpj, senha: config.braspressPassword };
  afterEach(() => {
    config.braspressCnpj = credenciais.cnpj;
    config.braspressPassword = credenciais.senha;
  });

  function t(parcial: Partial<Transportadora>): Transportadora {
    return {
      id: 't',
      nomeRazaoSocial: 'Transp',
      nomeFantasia: null,
      cnpj: null,
      email: null,
      telefone: null,
      contato: null,
      ativo: true,
      observacoes: null,
      codigoClienteOmie: null,
      canalPrincipal: null,
      urlPortal: null,
      whatsappCotacao: null,
      criadoEm: '',
      atualizadoEm: '',
      ...parcial,
    } as Transportadora;
  }

  it('exige o contato do canal; não definido/SITE não exigem nada', () => {
    expect(problemaCanalPrincipal(t({}), 'EMAIL')).toMatch(/E-mail para cotação/);
    expect(problemaCanalPrincipal(t({ email: 'a@b.com' }), 'EMAIL')).toBeNull();
    expect(problemaCanalPrincipal(t({ codigoClienteOmie: 10 }), 'EMAIL')).toBeNull();
    expect(problemaCanalPrincipal(t({ telefone: '11999990000' }), 'WHATSAPP')).toMatch(/WhatsApp para cotação/);
    expect(problemaCanalPrincipal(t({ whatsappCotacao: '11999990000' }), 'WHATSAPP')).toBeNull();
    expect(problemaCanalPrincipal(t({}), null)).toBeNull();
    expect(problemaCanalPrincipal(t({}), 'SITE')).toBeNull();
  });

  it('API só com integração existente E configurada', () => {
    expect(problemaCanalPrincipal(t({ urlPortal: 'https://portal' }), 'API')).toMatch(/integração existente/);
    config.braspressCnpj = '';
    config.braspressPassword = '';
    expect(problemaCanalPrincipal(t({ nomeRazaoSocial: 'BRASPRESS' }), 'API')).toMatch(/não está configurada/);
    config.braspressCnpj = 'cnpj-teste';
    config.braspressPassword = 'senha-teste';
    expect(problemaCanalPrincipal(t({ nomeRazaoSocial: 'BRASPRESS' }), 'API')).toBeNull();
  });
});

describe('WhatsApp — total combinado (observações da cotação + rótulo + observação da transportadora), sem corte silencioso', () => {
  it('template: mensagem de erro mostra a composição do total', () => {
    const p = montarPayloadN8n(
      cotacao({ observacoes: 'y'.repeat(200) }),
      solicitacao({ canal: 'WHATSAPP', observacoesTransportadora: 'x'.repeat(900) }),
      CNPJS,
      '5511999990000',
    );
    const problema = problemaLimiteWhatsapp(p, 'TEMPLATE');
    // 200 + " | " (3) + "Observações para a transportadora: " (35) + 900 = 1138
    expect(problema).toContain('Total: 1138 caracteres = observações da cotação (200) + rótulo e separadores (38) + "Observações para a transportadora" (900)');
    expect(problemaLimiteWhatsapp(montarPayloadN8n(cotacao(), solicitacao({ canal: 'WHATSAPP', observacoesTransportadora: 'x'.repeat(900) }), CNPJS, null), 'TEMPLATE')).toBeNull();
  });

  it('template: exatamente 1024 (limite documentado da YCloud) passa; 1025 é recusado', () => {
    const rotulo = 'Observações para a transportadora: ';
    const obsCotacao = 'y'.repeat(1024 - 3 - rotulo.length - 10);
    expect(parametroObservacoesTemplate(obsCotacao, 'x'.repeat(10))).toHaveLength(1024);
    expect(parametroObservacoesTemplate(obsCotacao, 'x'.repeat(11))).toBeNull();
  });

  it('texto livre: acima de 4096 no total → erro explícito com a composição; montarTextoWhatsapp nunca corta', () => {
    const p = montarPayloadN8n(
      cotacao({ observacoes: 'y'.repeat(3500) }),
      solicitacao({ canal: 'WHATSAPP', observacoesTransportadora: 'x'.repeat(900) }),
      CNPJS,
      '5511999990000',
    );
    expect(problemaLimiteWhatsapp(p, 'TEXTO')).toMatch(/limite 4096\) — observações da cotação: 3500; "Observações para a transportadora": 900/);
    expect(() => montarTextoWhatsapp(p)).toThrow(ErroValidacao);
    const curto = montarPayloadN8n(cotacao({ observacoes: 'y'.repeat(2000) }), solicitacao({ canal: 'WHATSAPP', observacoesTransportadora: 'x'.repeat(900) }), CNPJS, null);
    expect(problemaLimiteWhatsapp(curto, 'TEXTO')).toBeNull();
    expect(montarTextoWhatsapp(curto)).toContain('x'.repeat(900));
  });

  it('cliente YCloud: texto > 4096 é recusado sem chamar a API (antes era cortado em silêncio)', async () => {
    const original = { chave: config.ycloudApiKey, de: config.ycloudWhatsappFrom };
    config.ycloudApiKey = 'chave-de-teste';
    config.ycloudWhatsappFrom = '+5511900000000';
    const fetchFalso = vi.fn();
    try {
      await expect(enviarWhatsappYCloud({ tipo: 'texto', para: '+5511922222222', texto: 'z'.repeat(4097) }, fetchFalso as unknown as typeof fetch)).rejects.toThrow(
        /YCLOUD_MENSAGEM_LONGA: a mensagem tem 4097 caracteres/,
      );
      expect(fetchFalso).not.toHaveBeenCalled();
    } finally {
      config.ycloudApiKey = original.chave;
      config.ycloudWhatsappFrom = original.de;
    }
  });
});

describe('API — só integração cadastrada E configurada', () => {
  const credenciais = { cnpj: config.braspressCnpj, senha: config.braspressPassword };
  afterEach(() => {
    config.braspressCnpj = credenciais.cnpj;
    config.braspressPassword = credenciais.senha;
  });
  const braspress = { nomeRazaoSocial: 'BRASPRESS', nomeFantasia: null, email: null, codigoClienteOmie: null, whatsappCotacao: null } as Transportadora;

  it('Braspress sem credenciais no servidor: API não aparece como canal disponível', () => {
    config.braspressCnpj = '';
    config.braspressPassword = '';
    expect(canaisDisponiveis(braspress)).toEqual([]);
    config.braspressCnpj = 'cnpj-teste';
    config.braspressPassword = 'senha-teste';
    expect(canaisDisponiveis(braspress)).toEqual(['API']);
  });

  it('portal/URL ou nome qualquer nunca vira API', () => {
    config.braspressCnpj = 'cnpj-teste';
    config.braspressPassword = 'senha-teste';
    expect(canaisDisponiveis({ ...braspress, nomeRazaoSocial: 'Patrus', urlPortal: 'https://portal' } as Transportadora)).toEqual([]);
  });
});

describe('WhatsApp template — parâmetros {{1}}..{{5}} acima do limite: erro explícito, nunca corte', () => {
  function payloadComEmbalagens(qtd: number) {
    const embalagens = Array.from({ length: qtd }, (_, i) => ({ altura: 0.11 + i / 1000, largura: 0.22, comprimento: 0.33, quantidade: i + 1 }));
    return montarPayloadN8n(cotacao(), solicitacao({ canal: 'WHATSAPP', embalagens }), CNPJS, '5511999990000');
  }

  it('{{5}} embalagens: dentro do limite segue inteiro (6 parâmetros, sem corte)', () => {
    const params = parametrosTemplateWhatsapp(payloadComEmbalagens(5));
    expect(params).toHaveLength(6);
    expect(params[4]).toContain('Quantidade: 5');
    expect(params[4]!.length).toBeLessThanOrEqual(LIMITE_PARAMETRO_TEMPLATE_WHATSAPP);
  });

  it('{{5}} embalagens acima de 1024: ErroValidacao nomeando o parâmetro e o tamanho; pré-verificação devolve o mesmo motivo', () => {
    const p = payloadComEmbalagens(30);
    expect(() => parametrosTemplateWhatsapp(p)).toThrow(/parâmetro \{\{5\}\} embalagens do template de WhatsApp ficaria com \d+ caracteres \(limite 1024\)/);
    expect(problemaLimiteWhatsapp(p, 'TEMPLATE')).toContain('{{5}} embalagens');
  });

  it('{{3}} destino acima de 1024 (texto livre longo): recusado explicitamente', () => {
    const p = montarPayloadN8n(
      cotacao({ origemDestino: null, destino: 'D'.repeat(1100), logradouroDestino: null, numeroDestino: null, bairroDestino: null, cidadeDestino: null, ufDestino: null }),
      solicitacao({ canal: 'WHATSAPP' }),
      CNPJS,
      null,
    );
    expect(() => parametrosTemplateWhatsapp(p)).toThrow('{{3}} destino');
  });

  it('cliente YCloud: parâmetro de template > 1024 recusado sem chamar a API', async () => {
    const original = { chave: config.ycloudApiKey, de: config.ycloudWhatsappFrom };
    config.ycloudApiKey = 'chave-de-teste';
    config.ycloudWhatsappFrom = '+5511900000000';
    const fetchFalso = vi.fn();
    try {
      await expect(
        enviarWhatsappYCloud(
          { tipo: 'template', para: '+5511922222222', nome: 't', idioma: 'pt_BR', parametros: ['a', 'b', 'c', 'd', 'e'.repeat(1025), 'f'] },
          fetchFalso as unknown as typeof fetch,
        ),
      ).rejects.toThrow('YCLOUD_PARAMETRO_LONGO: o parâmetro {{5}} tem 1025 caracteres');
      expect(fetchFalso).not.toHaveBeenCalled();
    } finally {
      config.ycloudApiKey = original.chave;
      config.ycloudWhatsappFrom = original.de;
    }
  });
});

describe('modo de contingência n8n — observação nunca descartada em silêncio', () => {
  const original = { email: config.fretesEmailOutbound, whatsapp: config.fretesWhatsapp };
  afterEach(() => {
    config.fretesEmailOutbound = original.email;
    config.fretesWhatsapp = original.whatsapp;
  });

  it('com observação e canal roteado pelo n8n → problema explícito; sem observação ou envio direto → ok', () => {
    config.fretesEmailOutbound = 'n8n';
    config.fretesWhatsapp = 'ycloud';
    expect(problemaObservacaoViaN8n('EMAIL', 'Doca 3')).toContain('modo de contingência (n8n)');
    expect(problemaObservacaoViaN8n('EMAIL', null)).toBeNull();
    expect(problemaObservacaoViaN8n('WHATSAPP', 'Doca 3')).toBeNull();
    config.fretesWhatsapp = 'n8n';
    expect(problemaObservacaoViaN8n('WHATSAPP', 'Doca 3')).toMatch(/WhatsApp está no modo de contingência/);
    config.fretesEmailOutbound = 'smtp';
    expect(problemaObservacaoViaN8n('EMAIL', 'Doca 3')).toBeNull();
  });
});
