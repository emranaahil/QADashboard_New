const crypto = require('crypto');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuidv4() {
  return crypto.randomUUID();
}

function validateUuid(id) {
  return typeof id === 'string' && UUID_RE.test(id);
}

module.exports = { uuidv4, validateUuid };