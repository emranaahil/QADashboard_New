#!/usr/bin/env node
/**
 * Start API + Next.js using ports from project-root .env / .env.local.
 * Example worktree: PORT=3010, WEB_PORT=3011, WEB_APP_URL=http://localhost:3011
 */
const { spawn } = require('child_process');
const path = require('path');

require(path.join(__dirname, '..', 'backend', 'shared', 'loadEnv'));

const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const isWin = process.platform === 'win32';

const API_PORT = String(process.env.PORT || 3000);
const WEB_PORT = String(process.env.WEB_PORT || 3001);
const WEB_APP_URL = (process.env.WEB_APP_URL || `http://localhost:${WEB_PORT}`).replace(
  /\/$/,
  ''
);
const API_URL = (process.env.API_URL || `http://127.0.0.1:${API_PORT}`).replace(/\/$/, '');

process.env.PORT = API_PORT;
process.env.WEB_PORT = WEB_PORT;
process.env.WEB_APP_URL = WEB_APP_URL;
process.env.API_URL = API_URL;

const sharedEnv = {
  ...process.env,
  PORT: API_PORT,
  WEB_PORT,
  WEB_APP_URL,
  API_URL,
  FORCE_COLOR: process.env.FORCE_COLOR || '1',
};

console.log('Starting QA Dashboard dev');
console.log(`  API  :${API_PORT}  → ${API_URL}`);
console.log(`  UI   :${WEB_PORT}  → ${WEB_APP_URL}`);
console.log(`  Open ${WEB_APP_URL}/dashboard`);

const children = [];

function start(name, command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: isWin,
    ...options,
    env: { ...sharedEnv, ...(options.env || {}) },
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      console.error(`[${name}] exited via ${signal}`);
    } else if (code && code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
    }
    // If either dies, stop the other
    for (const c of children) {
      if (c !== child && !c.killed) {
        try {
          c.kill('SIGTERM');
        } catch {
          /* ignore */
        }
      }
    }
    process.exit(code ?? 0);
  });
  children.push(child);
  return child;
}

// API (loadEnv inside server.js also loads .env)
start('api', isWin ? 'npx.cmd' : 'npx', ['nodemon', '--config', 'nodemon.json', 'backend/server.js'], {
  cwd: ROOT,
  env: {
    PORT: API_PORT,
    WEB_APP_URL,
    API_URL,
  },
});

// Next must run with cwd=web so next.config + web/.env.local apply
start('web', isWin ? 'npx.cmd' : 'npx', ['next', 'dev', '-p', WEB_PORT], {
  cwd: WEB,
  env: {
    // Do not pass API PORT as Next's PORT
    PORT: WEB_PORT,
    API_URL,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || API_URL,
  },
});

function shutdown() {
  for (const c of children) {
    if (!c.killed) {
      try {
        c.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    }
  }
  setTimeout(() => process.exit(0), 500).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
