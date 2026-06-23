/**
 * Device catalog + runtime resolution.
 * Wraps config.js device arrays — does not replace config files.
 */

const PRESET_CATALOG = [
  { id: 'desktop', label: 'Desktop', width: 1440, height: 900 },
  { id: 'iphone13_portrait', label: 'iPhone13 Portrait', width: 390, height: 844 },
  { id: 'iphone13_landscape', label: 'iPhone13 Landscape', width: 844, height: 390 },
  { id: 'iphone15_plus_portrait', label: 'iPhone15 Plus Portrait', width: 430, height: 932 },
  { id: 'iphone15_plus_landscape', label: 'iPhone15 Plus Landscape', width: 932, height: 430 },
  { id: 's21_portrait', label: 'S21 Portrait', width: 360, height: 800 },
  { id: 's21_landscape', label: 'S21 Landscape', width: 800, height: 360 },
  { id: 'tablet_portrait', label: 'Tablet Portrait', width: 768, height: 1024 },
  { id: 'tablet_landscape', label: 'Tablet Landscape', width: 1024, height: 768 }
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
      const w = Number(item.width);
      const h = Number(item.height);
      if (!item.name || !Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) {
        throw new Error('Invalid custom device: name, width, and height are required');
      }
      out.push({
        label: slugifyLabel(item.name),
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

function applyDevicesToEnv(devices) {
  if (devices?.length) {
    process.env.QA_DEVICES_JSON = JSON.stringify(devices);
  }
}

module.exports = {
  PRESET_CATALOG,
  getCatalog,
  resolveDevices,
  applyDevicesToEnv
};