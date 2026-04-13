/**
 * Vite 6 expects globalThis.crypto.getRandomValues (Web Crypto).
 * Some Node/container setups expose an incomplete globalThis.crypto.
 * Load with: node --import ./scripts/webcrypto-polyfill.mjs ...vite...
 */
import { webcrypto } from 'node:crypto';

const g = globalThis;
const c = g.crypto;
if (!c || typeof c.getRandomValues !== 'function') {
  g.crypto = webcrypto;
}
