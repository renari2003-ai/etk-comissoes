/**
 * Ponto de entrada da função serverless do Vercel (regra de 2026-09-11) —
 * reaproveita o MESMO app Express de `src/appExpress.ts`, sem chamar
 * `.listen()` (o Vercel cuida de receber a requisição HTTP e invocar este
 * handler). Um app Express já é compatível com a assinatura
 * `(req, res) => void` que o runtime Node do Vercel espera, então não
 * precisa de nenhum adaptador.
 *
 * Fica fora de `src/` de propósito — é convenção do Vercel: todo arquivo em
 * `api/` na raiz do projeto vira uma função serverless própria.
 */
import { criarApp } from '../src/appExpress.js';

export default criarApp();
