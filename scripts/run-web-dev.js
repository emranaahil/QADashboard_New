#!/usr/bin/env node
/** Start Next.js UI only, using WEB_PORT / API_URL from project-root .env */
const { spawn } = require('child_process');
const path = require('path');

require(path.join(__dirname, '..', 'backend', 'shared', 'loadEnv'));

const ROOT = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';
const WEB_PORT = String(process.env.WEB_PORT || 3001);
const API_PORT = String(process.env.PORT || 3000);
const API_URL = (process.env.API_URL || `http://127.0.0.1:${API_PORT}`).replace(/\/$/, '');

console.log(`Starting Next.js on :${WEB_PORT} (API rewrite → ${API_URL})`);

const child = spawn(
  isWin ? 'npx.cmd' : 'npx',
  ['next', 'dev', '-p', WEB_PORT],
  {
    cwd: path.join(ROOT, 'web'),
    stdio: 'inherit',
    env: {
      ...process.env,
      API_URL,
      PORT: undefined, // avoid Next mistaking API PORT for its own
    },
    shell: isWin,
  }
);

child.on('exit', (code) => process.exit(code ?? 0));
