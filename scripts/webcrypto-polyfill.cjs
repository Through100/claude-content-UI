'use strict';
/**
 * Vite 6 expects globalThis.crypto.getRandomValues (Web Crypto).
 * Loaded before Vite via: node -r ./scripts/webcrypto-polyfill.cjs ...vite...
 * Uses -r instead of --import so Node 16+ works (--import needs newer Node).
 */
const { webcrypto } = require('node:crypto');
if (webcrypto && typeof webcrypto.getRandomValues === 'function') {
  const g = globalThis;
  if (!g.crypto || typeof g.crypto.getRandomValues !== 'function') {
    g.crypto = webcrypto;
  }
}
