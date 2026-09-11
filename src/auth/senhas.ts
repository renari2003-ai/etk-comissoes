import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const TAMANHO_SALT_BYTES = 16;
const TAMANHO_HASH_BYTES = 64;

/** Hash de senha via scrypt (nativo do Node — sem dependência externa tipo bcrypt). Formato: "scrypt$saltHex$hashHex". */
export function hashSenha(senha: string): string {
  const salt = randomBytes(TAMANHO_SALT_BYTES);
  const hash = scryptSync(senha, salt, TAMANHO_HASH_BYTES);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** Comparação em tempo constante (`timingSafeEqual`) — nunca comparar hashes com `===` (vaza timing). */
export function verificarSenha(senha: string, hashArmazenado: string): boolean {
  const partes = hashArmazenado.split('$');
  if (partes.length !== 3 || partes[0] !== 'scrypt') return false;
  const [, saltHex, hashHex] = partes;
  if (saltHex === undefined || hashHex === undefined) return false;

  const salt = Buffer.from(saltHex, 'hex');
  const hashEsperado = Buffer.from(hashHex, 'hex');
  const hashCalculado = scryptSync(senha, salt, hashEsperado.length);

  return hashCalculado.length === hashEsperado.length && timingSafeEqual(hashCalculado, hashEsperado);
}
