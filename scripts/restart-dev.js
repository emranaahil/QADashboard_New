#!/usr/bin/env node
/**
 * Stops anything on ports 3000 (API) and 3001 (Next.js), then starts npm run dev.
 * Use: npm run dev:restart
 */
const { execSync, spawn } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORTS = [3000, 3001];
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

console.log('Restarting dev servers (API :3000, UI :3001)...');
for (const port of PORTS) killPort(port);

const child = spawn(isWin ? 'npm.cmd' : 'npm', ['run', 'dev'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: process.env,
  shell: isWin
});

child.on('exit', (code) => process.exit(code ?? 0));