/**
 * Production security middleware — rate limiting and CORS policy.
 */

function createRateLimiter({ windowMs = 60_000, max = 120, skip = () => false } = {}) {
  const hits = new Map();

  return (req, res, next) => {
    if (skip(req)) return next();

    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter((t) => now - t < windowMs);

    if (recent.length >= max) {
      return res.status(429).json({
        error: 'RATE_LIMITED',
        message: 'Too many requests. Please try again later.'
      });
    }

    recent.push(now);
    hits.set(ip, recent);
    next();
  };
}

/** Allow both localhost and 127.0.0.1 for the same UI port (common local mismatch). */
function expandDevOrigins(baseList) {
  const set = new Set();
  for (const raw of baseList) {
    const o = String(raw || '').trim().replace(/\/$/, '');
    if (!o) continue;
    set.add(o);
    try {
      const u = new URL(o);
      if (u.hostname === 'localhost') {
        u.hostname = '127.0.0.1';
        set.add(u.origin);
      } else if (u.hostname === '127.0.0.1') {
        u.hostname = 'localhost';
        set.add(u.origin);
      }
    } catch {
      /* ignore invalid */
    }
  }
  // Worktree + default ports
  for (const port of [3001, 3011, 3000, 3010]) {
    set.add(`http://localhost:${port}`);
    set.add(`http://127.0.0.1:${port}`);
  }
  return [...set];
}

function buildCorsOptions({ apiOnly, webAppUrl }) {
  if (apiOnly) {
    return {
      origin: false,
      credentials: false
    };
  }

  const configured = (process.env.ALLOWED_ORIGINS || webAppUrl || 'http://localhost:3001')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const origins = expandDevOrigins(configured);

  return {
    origin(origin, callback) {
      if (!origin || origins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true
  };
}

module.exports = { createRateLimiter, buildCorsOptions };