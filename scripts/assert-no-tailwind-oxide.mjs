/**
 * Tailwind v4's @tailwindcss/vite loads @tailwindcss/oxide (native).
 * This project uses Tailwind v3 + PostCSS. Stale node_modules or old
 * vite.config.ts cause confusing "Cannot find native binding" errors.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const root = process.cwd();

function fail(msg) {
  console.error('\n[claude-seo-ui] ' + msg + '\n');
  process.exit(1);
}

const vitePath = join(root, 'vite.config.ts');
if (!existsSync(vitePath)) {
  fail(`Missing vite.config.ts in ${root}`);
}

const viteSource = readFileSync(vitePath, 'utf8');
if (viteSource.includes('@tailwindcss/vite')) {
  fail(`vite.config.ts still references Tailwind v4 tooling.
Update this checkout to latest main (Tailwind v3 + PostCSS), for example:
  git fetch origin && git reset --hard origin/main
Then reinstall:
  rm -rf node_modules
  npm install`);
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
if (allDeps['@tailwindcss/vite']) {
  fail(`package.json still lists @tailwindcss/* (v4). Sync with origin/main and run:
  rm -rf node_modules package-lock.json
  npm install`);
}

const oxide = join(root, 'node_modules/@tailwindcss/oxide');
const twVite = join(root, 'node_modules/@tailwindcss/vite');
if (existsSync(oxide) || existsSync(twVite)) {
  fail(`Stale packages found under node_modules/@tailwindcss/*.
Remove the install and reinstall so only Tailwind v3 remains:
  rm -rf node_modules
  npm install
(If this persists, also remove package-lock.json and run npm install again.)`);
}
