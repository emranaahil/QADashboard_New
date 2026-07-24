/**
 * HTTP image probing — file size and intrinsic dimensions from response bytes.
 */

const MAX_PROBE_BYTES = 5 * 1024 * 1024;

function parseImageDimensions(buffer) {
  if (!buffer || buffer.length < 10) return null;

  // PNG — IHDR chunk at offset 16
  if (buffer.length >= 24 && buffer[0] === 0x89 && buffer[1] === 0x50) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  // GIF
  if (buffer.length >= 10 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }

  // JPEG — scan for SOF marker
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let i = 2;
    while (i < buffer.length - 9) {
      if (buffer[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = buffer[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return {
          height: buffer.readUInt16BE(i + 5),
          width: buffer.readUInt16BE(i + 7)
        };
      }
      const len = buffer.readUInt16BE(i + 2);
      if (len < 2) break;
      i += 2 + len;
    }
  }

  // WebP (RIFF container)
  if (buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buffer.toString('ascii', 12, 16);
    if (chunk === 'VP8 ' && buffer.length >= 30) {
      return {
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff
      };
    }
    if (chunk === 'VP8L' && buffer.length >= 25) {
      const bits = buffer.readUInt32LE(21);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1
      };
    }
    if (chunk === 'VP8X' && buffer.length >= 30) {
      return {
        width: 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16)),
        height: 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16))
      };
    }
  }

  // BMP
  if (buffer.length >= 26 && buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return {
      width: buffer.readInt32LE(18),
      height: Math.abs(buffer.readInt32LE(22))
    };
  }

  return null;
}

async function probeImageUrl(request, url, helpers = {}) {
  const formatFromMime = helpers.formatFromMime || (() => null);
  const formatFromUrl = helpers.formatFromUrl || (() => 'UNKNOWN');

  try {
    const resp = await request.get(url, { timeout: 20000 });
    const status = resp.status();
    const headers = resp.headers();
    const ct = headers['content-type'] || '';

    let buf = Buffer.alloc(0);
    try {
      buf = await resp.body();
      if (buf.length > MAX_PROBE_BYTES) {
        buf = buf.subarray(0, MAX_PROBE_BYTES);
      }
    } catch {
      // body unavailable — fall back to content-length
    }

    const cl = parseInt(headers['content-length'] || '0', 10) || 0;
    const bytes = buf.length || cl || 0;
    const dims = parseImageDimensions(buf);

    return {
      status,
      bytes,
      contentType: ct,
      headers,
      requestCount: 1,
      probed: true,
      probedWidth: dims?.width || 0,
      probedHeight: dims?.height || 0,
      format: formatFromMime(ct) || formatFromUrl(url)
    };
  } catch {
    return {
      status: null,
      bytes: 0,
      contentType: null,
      headers: {},
      requestCount: 0,
      error: 'probe-failed',
      probed: true,
      probedWidth: 0,
      probedHeight: 0
    };
  }
}

module.exports = {
  MAX_PROBE_BYTES,
  parseImageDimensions,
  probeImageUrl
};