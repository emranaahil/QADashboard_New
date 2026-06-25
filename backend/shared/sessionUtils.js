const { validateUuid } = require('./uuidUtils');

const SESSION_HEADER = 'x-qa-session-id';

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    out[key] = decodeURIComponent(val);
  }
  return out;
}

function isValidSessionId(value) {
  return validateUuid(value);
}

function getSessionIdFromRequest(req) {
  const header = req.headers?.[SESSION_HEADER];
  if (isValidSessionId(header)) return header;

  const query = req.query?.qaSession || req.query?.sessionId;
  if (isValidSessionId(query)) return query;

  const cookies = parseCookies(req.headers?.cookie);
  if (isValidSessionId(cookies.qa_session_id)) return cookies.qa_session_id;

  return null;
}

function shouldFilterBySession(sessionId) {
  return Boolean(sessionId);
}

module.exports = {
  SESSION_HEADER,
  isValidSessionId,
  getSessionIdFromRequest,
  shouldFilterBySession
};