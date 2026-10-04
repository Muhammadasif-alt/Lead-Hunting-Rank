// First-time setup: `pnpm setup`. Safe to run again — it never overwrites an existing .env.
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';

const ok = (msg) => console.log(`  ✓ ${msg}`);
const warn = (msg) => console.log(`  ✕ ${msg}`);

console.log('\nRevenue OS — setup\n');

if (existsSync('.env')) {
  ok('.env already exists (left unchanged)');
} else {
  copyFileSync('.env.example', '.env');
  ok('.env created from .env.example');
}

const [major] = process.versions.node.split('.').map(Number);
major >= 24 ? ok(`Node ${process.versions.node}`) : warn(`Node ${process.versions.node} — need 24+`);

let dockerReady = false;
try {
  execSync('docker info', { stdio: 'ignore' });
  dockerReady = true;
  ok('Docker is running');
} catch {
  warn('Docker is not running — start Docker Desktop (it needs WSL: `wsl --install` in an admin terminal, then restart)');
}

console.log('\nNext steps:');
if (!dockerReady) console.log('  0. Start Docker Desktop');
console.log('  1. pnpm infra:up     # starts PostgreSQL + Redis in Docker');
console.log('  2. pnpm db:deploy    # creates the database tables (migrations)');
console.log('  3. pnpm db:seed      # dev workspace, owner user, roles, default pipeline');
console.log('  4. pnpm dev          # starts web (3000) + api (4000) + worker');
console.log('  5. open http://localhost:3000/diagnostics — all five rows should be ✓\n');
