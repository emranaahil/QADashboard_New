#!/usr/bin/env node
/**
 * Stops anything on configured API/UI ports, then starts npm run dev.
 * Ports: PORT (default 3000) and WEB_PORT (default 3001) from .env / .env.local
 */
const { execSync, spawn } = require('child_process');
const path = require('path');

require(path.join(__dirname, '..', 'backend', 'shared', 'loadEnv'));

const ROOT = path.resolve(__dirname, '..');
const API_PORT = Number(process.env.PORT || 3000);
const WEB_PORT = Number(process.env.WEB_PORT || 3001);
const PORTS = [API_PORT, WEB_PORT];
const isWin = process.platform === 'win32';

function killPort(port) {
  const pids = new Set();
  try {
    if (isWin) {
      const out = execSync('netstat -ano', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      for (const line of out.split('\n')) {
        if (!line.includes('LISTENING') || !line.includes(`:${port}`)) continue;
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && /^\d+$/.test(pid) && pid !== '0') pids.add(pid);
      }
    } else {
      const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN 2>/dev/null || true`, {
        encoding: 'utf8',
        shell: true
      });
      for (const pid of out.trim().split('\n').filter(Boolean)) pids.add(pid);
    }
  } catch {
    /* port likely free */
  }

  for (const pid of pids) {
    try {
      if (isWin) execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
      else execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
      console.log(`Stopped process ${pid} on port ${port}`);
    } catch {
      /* already gone */
    }
  }
}

console.log(`Restarting dev servers (API :${API_PORT}, UI :${WEB_PORT})...`);
for (const port of PORTS) killPort(port);

const child = spawn(isWin ? 'npm.cmd' : 'npm', ['run', 'dev'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: String(API_PORT),
    WEB_PORT: String(WEB_PORT),
    WEB_APP_URL: process.env.WEB_APP_URL || `http://localhost:${WEB_PORT}`,
    API_URL: process.env.API_URL || `http://127.0.0.1:${API_PORT}`,
  },
  shell: isWin
});

child.on('exit', (code) => process.exit(code ?? 0));