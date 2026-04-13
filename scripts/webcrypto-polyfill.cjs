'use strict';
/**
 * Vite 6 expects globalThis.crypto.getRandomValues (Web Crypto).
 * Loaded before Vite via: node -r ./scripts/webcrypto-polyfill.cjs ...vite...
 * Uses -r instead of --import so Node 16+ works (--import needs newer Node).
 */

try {
  const { webcrypto } = require('node:crypto');

  // Set on globalThis for ESM/bundled code
  if (webcrypto && typeof webcrypto.getRandomValues === 'function') {
    globalThis.crypto = webcrypto;
  }

  // Also patch the crypto module exports in case code imports getRandomValues from 'crypto'
  const cryptoModule = require('node:crypto');
  if (webcrypto && !cryptoModule.getRandomValues && typeof webcrypto.getRandomValues === 'function') {
    cryptoModule.getRandomValues = webcrypto.getRandomValues.bind(webcrypto);
  }
} catch (err) {
  // Silently ignore if crypto module can't be loaded
}
