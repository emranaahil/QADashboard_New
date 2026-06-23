function deriveModelId(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    let clean = url.trim();
    if (!/^https?:\/\//i.test(clean)) clean = `https://${clean}`;
    const u = new URL(clean);
    return u.hostname.toLowerCase().replace(/[^a-z0-9.-]/g, '-');
  } catch {
    return null;
  }
}

function validateModelId(modelId) {
  if (!modelId || typeof modelId !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,126}$/i.test(modelId)) {
    throw new Error('Invalid model ID');
  }
}

module.exports = { deriveModelId, validateModelId };