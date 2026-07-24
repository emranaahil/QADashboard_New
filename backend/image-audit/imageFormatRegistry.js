/**
 * Canonical image extension + MIME registry for Image Audit.
 */

const EXTENSION_TO_FORMAT = {
  jpg: 'JPEG',
  jpeg: 'JPEG',
  jpe: 'JPEG',
  jfif: 'JPEG',
  pjp: 'JPEG',
  pjpeg: 'JPEG',
  png: 'PNG',
  webp: 'WEBP',
  avif: 'AVIF',
  svg: 'SVG',
  gif: 'GIF',
  apng: 'APNG',
  bmp: 'BMP',
  ico: 'ICO',
  cur: 'ICO',
  tif: 'TIFF',
  tiff: 'TIFF',
  heic: 'HEIC',
  heif: 'HEIF',
  jxl: 'JXL',
  wbmp: 'WBMP'
};

const MIME_TO_FORMAT = {
  'image/jpeg': 'JPEG',
  'image/jpg': 'JPEG',
  'image/pjpeg': 'JPEG',
  'image/png': 'PNG',
  'image/gif': 'GIF',
  'image/webp': 'WEBP',
  'image/avif': 'AVIF',
  'image/svg+xml': 'SVG',
  'image/apng': 'APNG',
  'image/bmp': 'BMP',
  'image/x-icon': 'ICO',
  'image/vnd.microsoft.icon': 'ICO',
  'image/tiff': 'TIFF',
  'image/heic': 'HEIC',
  'image/heif': 'HEIF',
  'image/jxl': 'JXL',
  'image/vnd.wap.wbmp': 'WBMP'
};

const EXTENSION_ALTERNATION = Object.keys(EXTENSION_TO_FORMAT)
  .sort((a, b) => b.length - a.length)
  .join('|');

const EXTENSION_REGEX = new RegExp(`\\.(${EXTENSION_ALTERNATION})(?:\\?|#|$)`, 'i');

const HTML_QUOTED_URL_REGEX = new RegExp(
  `["']([^"']+\\.(?:${EXTENSION_ALTERNATION})(?:\\?[^"']*)?)["']`,
  'gi'
);

const HTML_ABSOLUTE_URL_REGEX = new RegExp(
  `(https?:\\/\\/[^\\s"'<>]+\\.(?:${EXTENSION_ALTERNATION})(?:\\?[^\\s"'<>]*)?)`,
  'gi'
);

const DATA_IMAGE_REGEX = /^data:image\/([a-z0-9.+-]+)/i;

const ALL_FORMATS = [...new Set([...Object.values(EXTENSION_TO_FORMAT), ...Object.values(MIME_TO_FORMAT)])].sort();

function normalizeMime(mime) {
  return String(mime || '').split(';')[0].trim().toLowerCase();
}

function formatFromExtension(url) {
  if (!url || url.startsWith('inline-svg:')) return url.startsWith('inline-svg:') ? 'SVG' : null;
  const ext = (String(url).split('?')[0].split('#')[0].split('.').pop() || '').toLowerCase();
  return EXTENSION_TO_FORMAT[ext] || null;
}

function formatFromDataUrl(url) {
  const m = String(url || '').match(DATA_IMAGE_REGEX);
  if (!m) return null;
  const token = m[1].toLowerCase().replace('svg+xml', 'svg').replace('pjpeg', 'jpeg');
  return EXTENSION_TO_FORMAT[token] || token.toUpperCase();
}

function formatFromMime(contentType) {
  const mime = normalizeMime(contentType);
  if (!mime) return null;
  if (MIME_TO_FORMAT[mime]) return MIME_TO_FORMAT[mime];
  if (mime.startsWith('image/')) {
    const sub = mime.slice(6).replace('+xml', '').replace('x-', '');
    return EXTENSION_TO_FORMAT[sub] || sub.toUpperCase();
  }
  return null;
}

function formatFromUrl(url) {
  if (!url) return 'UNKNOWN';
  if (url.startsWith('inline-svg:')) return 'SVG';
  const fromData = formatFromDataUrl(url);
  if (fromData) return fromData;
  return formatFromExtension(url) || 'UNKNOWN';
}

function isImageUrl(url) {
  if (!url) return false;
  if (url.startsWith('data:image/')) return true;
  if (url.startsWith('inline-svg:')) return true;
  const path = String(url).split('?')[0].split('#')[0];
  return EXTENSION_REGEX.test(path);
}

function isImageMime(contentType) {
  const mime = normalizeMime(contentType);
  if (!mime) return false;
  if (MIME_TO_FORMAT[mime]) return true;
  return mime.startsWith('image/');
}

function isImageResponse(url, contentType) {
  return isImageMime(contentType) || isImageUrl(url);
}

/** Serializable config injected into page.evaluate for source discovery. */
function getBrowserFormatConfig() {
  return {
    extMap: EXTENSION_TO_FORMAT,
    extPattern: EXTENSION_ALTERNATION,
    mimeMap: MIME_TO_FORMAT
  };
}

module.exports = {
  EXTENSION_TO_FORMAT,
  MIME_TO_FORMAT,
  EXTENSION_ALTERNATION,
  EXTENSION_REGEX,
  HTML_QUOTED_URL_REGEX,
  HTML_ABSOLUTE_URL_REGEX,
  DATA_IMAGE_REGEX,
  ALL_FORMATS,
  normalizeMime,
  formatFromExtension,
  formatFromDataUrl,
  formatFromMime,
  formatFromUrl,
  isImageUrl,
  isImageMime,
  isImageResponse,
  getBrowserFormatConfig
};