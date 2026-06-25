/**
 * Device catalog + runtime resolution.
 * Wraps config.js device arrays — does not replace config files.
 */

const fs = require('fs-extra');
const path = require('path');

const PRESET_CATALOG = [
  { id: 'desktop', label: 'Desktop', width: 1440, height: 900 },
  { id: 'iphone13_portrait', label: 'iPhone13', width: 390, height: 844 },
  { id: 'iphone15_plus_portrait', label: 'iPhone15 Plus', width: 430, height: 932 },
  { id: 's21_portrait', label: 'S21', width: 360, height: 800 },
  { id: 'tablet_portrait', label: 'Tablet', width: 768, height: 1024 }
];

function slugifyLabel(name) {
  return String(name || 'Custom')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 48) || 'Custom';
}

function getCatalog() {
  return PRESET_CATALOG.map(d => ({ ...d }));
}

/**
 * Resolve frontend selection into runtime device array for config injection.
 * @param {Array<string|{name:string,width:number,height:number}>} selected
 */
function resolveDevices(selected) {
  if (!Array.isArray(selected) || !selected.length) {
    return [{ label: 'Desktop', width: 1440, height: 900 }];
  }

  const catalogById = Object.fromEntries(PRESET_CATALOG.map(d => [d.id, d]));
  const out = [];

  for (const item of selected) {
    if (typeof item === 'string') {
      const preset = catalogById[item];
      if (preset) {
        out.push({
          label: preset.label.replace(/\s+/g, '_'),
          width: preset.width,
          height: preset.height
        });
      }
      continue;
    }
    if (item && typeof item === 'object') {
      const displayName = String(item.name || item.label || '').trim();
      const w = Number(item.width);
      const h = Number(item.height);
      if (!displayName || !Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) {
        throw new Error('Invalid custom device: name, width, and height are required');
      }
      out.push({
        label: slugifyLabel(displayName),
        width: Math.round(w),
        height: Math.round(h)
      });
    }
  }

  if (!out.length) {
    return [{ label: 'Desktop', width: 1440, height: 900 }];
  }
  return out;
}

async function applyDevicesToEnv(devices) {
  if (!devices?.length) return;

  process.env.QA_DEVICES_JSON = JSON.stringify(devices);

  const jobDir = process.env.QA_JOB_DIR ? path.resolve(process.env.QA_JOB_DIR) : null;
  if (jobDir) {
    await fs.ensureDir(jobDir);
    await fs.writeJson(path.join(jobDir, 'devices.runtime.json'), devices, { spaces: 2 });
  }
}

module.exports = {
  PRESET_CATALOG,
  getCatalog,
  resolveDevices,
  applyDevicesToEnv
};