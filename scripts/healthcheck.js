/**
 * Docker / Render health probe — exits 0 when API is healthy.
 * Prefer API_PORT (Express) — it starts before Next.js on PORT.
 */
const http = require('http');

const port = process.env.API_PORT || process.env.PORT || 10000;

const req = http.get(
  { host: '127.0.0.1', port, path: '/api/health', timeout: 8000 },
  (res) => {
    process.exit(res.statusCode === 200 ? 0 : 1);
  }
);

req.on('error', () => process.exit(1));
req.on('timeout', () => {
  req.destroy();
  process.exit(1);
});