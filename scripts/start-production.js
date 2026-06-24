/**
 * Production entrypoint — Express API (internal) + Next.js UI (public port).
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const API_PORT = process.env.API_PORT || '3000';
const WEB_PORT = process.env.PORT || '10000';
const projectRoot = path.join(__dirname, '..');

function resolveWebApp() {
  const dockerWeb = path.join(projectRoot, 'web', 'server.js');
  if (fs.existsSync(dockerWeb)) {
    return path.join(projectRoot, 'web');
  }

  const standaloneWeb = path.join(projectRoot, 'web', '.next', 'standalone', 'web', 'server.js');
  if (fs.existsSync(standaloneWeb)) {
    return path.join(projectRoot, 'web', '.next', 'standalone', 'web');
  }

  throw new Error('Next.js production build not found. Run: npm run build:web');
}

const webDir = resolveWebApp();

const children = [];

function start(name, command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    ...options
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      console.error(`[${name}] exited via ${signal}`);
    } else if (code && code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
      shutdown(code);
    }
  });

  children.push(child);
  return child;
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }
  setTimeout(() => process.exit(code), 500).unref();
}

process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));

console.log(`Starting QA Dashboard (API :${API_PORT}, UI :${WEB_PORT})`);

start('api', 'node', ['backend/server.js'], {
  env: {
    ...process.env,
    PORT: API_PORT,
    NODE_ENV: 'production'
  }
});

start('web', 'node', ['server.js'], {
  cwd: webDir,
  env: {
    ...process.env,
    PORT: WEB_PORT,
    HOSTNAME: '0.0.0.0',
    NODE_ENV: 'production',
    API_URL: process.env.API_URL || `http://127.0.0.1:${API_PORT}`
  }
});