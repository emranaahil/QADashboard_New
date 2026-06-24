/**
 * Production security middleware — rate limiting and CORS policy.
 */

function createRateLimiter({ windowMs = 60_000, max = 120 } = {}) {
  const hits = new Map();

  return (req, res, next) => {
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

function buildCorsOptions({ apiOnly, webAppUrl }) {
  if (apiOnly) {
    return {
      origin: false,
      credentials: false
    };
  }

  const origins = (process.env.ALLOWED_ORIGINS || webAppUrl || 'http://localhost:3001')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

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