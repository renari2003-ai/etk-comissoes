import { describe, expect, it } from 'vitest';
import { hashSenha, verificarSenha } from '../../src/auth/senhas.js';

describe('hashSenha / verificarSenha', () => {
  it('o hash nunca é igual à senha em texto puro', () => {
    const hash = hashSenha('minhaSenha123');
    expect(hash).not.toBe('minhaSenha123');
    expect(hash.startsWith('scrypt$')).toBe(true);
  });

  it('verifica corretamente a senha certa', () => {
    const hash = hashSenha('correta123');
    expect(verificarSenha('correta123', hash)).toBe(true);
  });

  it('rejeita a senha errada', () => {
    const hash = hashSenha('correta123');
    expect(verificarSenha('errada456', hash)).toBe(false);
  });

  it('gera hashes diferentes para a mesma senha (salt aleatório)', () => {
    const hash1 = hashSenha('mesmaSenha');
    const hash2 = hashSenha('mesmaSenha');
    expect(hash1).not.toBe(hash2);
    expect(verificarSenha('mesmaSenha', hash1)).toBe(true);
    expect(verificarSenha('mesmaSenha', hash2)).toBe(true);
  });

  it('rejeita hash malformado sem lançar exceção', () => {
    expect(verificarSenha('qualquer', 'formato-invalido')).toBe(false);
  });
});
