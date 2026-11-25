'use strict';

/**
 * Pure logic: version comparison, hardware-ID matching and verdict rules.
 * No Electron, no filesystem, no child processes — every function here is
 * deterministic and covered by test/verdict.test.js.
 */

const LEVELS = ['update', 'error', 'review', 'unknown', 'current'];

function toArray(value) {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function asString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeDate(value) {
  const raw = asString(value);
  if (!raw) return null;
  const match = raw.match(/\/Date\((-?\d+)\)\//);
  if (match) {
    const ms = Number(match[1]);
    if (!Number.isFinite(ms)) return null;
    return new Date(ms).toISOString();
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizeHardwareIds(list) {
  return toArray(list)
    .map((id) => asString(id).toLowerCase())
    .filter(Boolean)
    .filter((id, index, all) => all.indexOf(id) === index);
}

/**
 * Device signature: bus + vendor + device, tolerant to the syntax differences
 * between Win32_PnPEntity (`USB\VID8086&PID1C26`) and Windows Update
 * (`usb\vid_8086&pid_1c26`) and to missing &SUBSYS/&REV suffixes.
 */
function signature(hardwareId) {
  const id = asString(hardwareId).toLowerCase();
  if (!id) return null;
  const bus = id.split('\\')[0] || '';
  const ven = id.match(/ven_?([0-9a-f]{4})/);
  const dev = id.match(/dev_?([0-9a-f]{4})/);
  const vid = id.match(/vid_?([0-9a-f]{4})/);
  const pid = id.match(/pid_?([0-9a-f]{4})/);
  const vendor = ven ? ven[1] : vid ? vid[1] : '';
  const device = dev ? dev[1] : pid ? pid[1] : '';
  if (!vendor || !device) return null;
  return `${bus}|${vendor}|${device}`;
}

function signaturesOf(list) {
  return new Set(normalizeHardwareIds(list).map(signature).filter(Boolean));
}

function hardwareIdsIntersect(a, b) {
  const left = signaturesOf(a);
  if (left.size === 0) return false;
  for (const sig of signaturesOf(b)) {
    if (left.has(sig)) return true;
  }
  return false;
}

function hasNumericVersion(value) {
  return /\d/.test(asString(value));
}

/** Numeric-dotted comparison: "10.0.19041.1" > "10.0.19041" > "9.9.9". */
function compareVersions(a, b) {
  const pa = asString(a).match(/\d+(?:\.\d+)*/g);
  const pb = asString(b).match(/\d+(?:\.\d+)*/g);
  if (!pa || !pb) return 0;
  const left = pa[0].split('.').map((n) => Number.parseInt(n, 10));
  const right = pb[0].split('.').map((n) => Number.parseInt(n, 10));
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const l = Number.isFinite(left[i]) ? left[i] : 0;
    const r = Number.isFinite(right[i]) ? right[i] : 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }
  return 0;
}

function monthsSince(dateIso, now = new Date()) {
  if (!dateIso) return null;
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) return null;
  const months = (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());
  return Math.max(0, months);
}

function formatDate(dateIso) {
  if (!dateIso) return 'fecha desconocida';
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) return 'fecha desconocida';
  return date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const MS_PROVIDERS = new Set(['microsoft', 'microsoft corporation', 'microsoft windows', 'microsoft® windows®']);

function isMicrosoftProvided(provider) {
  const value = asString(provider).toLowerCase();
  if (!value) return false;
  return MS_PROVIDERS.has(value) || value.startsWith('microsoft ');
}

function findMatchingUpdate(driver, updates) {
  const list = toArray(updates);
  if (list.length === 0) return null;
  for (const update of list) {
    if (hardwareIdsIntersect(driver.hardwareIds, update.hardwareIds)) return update;
  }
  // Only drivers that expose no hardware ID at all may fall back to the model
  // name, and only on an exact match: a loose containment match would attach an
  // unrelated package to a device and send the user to the wrong download.
  if (normalizeHardwareIds(driver.hardwareIds).length > 0) return null;
  const name = asString(driver.deviceName).toLowerCase().replace(/\s+/g, ' ');
  if (name.length < 6) return null;
  return (
    list.find((update) => {
      const model = asString(update.model).toLowerCase().replace(/\s+/g, ' ');
      return model.length >= 6 && model === name;
    }) || null
  );
}

/**
 * @param {object} driver normalized driver
 * @param {object|null} update matching Windows Update driver update
 * @param {object|null} entry catalog entry with a reference version
 * @param {{ageThresholdMonths:number, now?:Date}} options
 */
function verdictFor(driver, update, entry, options = {}) {
  const threshold = Number.isFinite(options.ageThresholdMonths) ? options.ageThresholdMonths : 24;
  const now = options.now instanceof Date ? options.now : new Date();

  if (options.notApplicable) {
    return {
      level: 'current',
      source: 'not-applicable',
      latestVersion: null,
      updateId: null,
      reason: `Ya se intentó instalar el paquete y el dispositivo sigue en la versión ${driver.driverVersion} (${formatDate(
        options.notApplicable.at,
      )}). Windows seguirá ofreciéndolo, pero no se aplica: usa el instalador del fabricante.`,
    };
  }

  if (update) {
    const bits = [asString(update.provider), asString(update.model)].filter(Boolean).join(' · ');
    return {
      level: 'update',
      source: 'windows-update',
      latestVersion: null,
      updateId: asString(update.updateId) || null,
      reason: `Windows Update ofrece ${bits || 'un paquete nuevo'}${update.driverDate ? ` (${formatDate(update.driverDate)})` : ''}.`,
    };
  }

  if (Number(driver.errorCode) > 0) {
    return {
      level: 'error',
      source: 'none',
      latestVersion: null,
      updateId: null,
      reason: `Windows reporta el código de problema ${driver.errorCode}; el controlador puede faltar o estar dañado.`,
    };
  }

  if (entry && asString(entry.latestVersion)) {
    if (!hasNumericVersion(driver.driverVersion) || !hasNumericVersion(entry.latestVersion)) {
      return {
        level: 'unknown',
        source: 'catalog',
        latestVersion: entry.latestVersion,
        updateId: null,
        reason: 'Hay una versión de referencia en el catálogo, pero la versión instalada no es numérica: no se puede comparar.',
      };
    }
    const cmp = compareVersions(driver.driverVersion, entry.latestVersion);
    if (cmp < 0) {
      return {
        level: 'update',
        source: 'catalog',
        latestVersion: entry.latestVersion,
        updateId: null,
        reason: `El catálogo local conoce la versión ${entry.latestVersion} y este equipo tiene ${driver.driverVersion}.`,
      };
    }
    return {
      level: 'current',
      source: 'catalog',
      latestVersion: entry.latestVersion,
      updateId: null,
      reason: `Versión ${driver.driverVersion} igual o posterior a la de referencia (${entry.latestVersion}).`,
    };
  }

  if (isMicrosoftProvided(driver.provider)) {
    return {
      level: 'current',
      source: 'none',
      latestVersion: null,
      updateId: null,
      reason: 'Controlador incluido en Windows; se actualiza con el sistema.',
    };
  }

  if (options.verifiedRecord) {
    return {
      level: 'current',
      source: 'verified',
      latestVersion: null,
      updateId: null,
      reason: `Verificado por ti el ${formatDate(options.verifiedRecord.at)}: comprobado en la web del fabricante.`,
    };
  }

  if (options.installedRecord) {
    return {
      level: 'current',
      source: 'install',
      latestVersion: options.installedRecord.version || null,
      updateId: null,
      reason: `Instalado por Snap Drivers Pro el ${formatDate(options.installedRecord.at)}${
        options.installedRecord.label ? ` (${options.installedRecord.label})` : ''
      }. Windows Update ya no ofrece nada más nuevo.`,
    };
  }

  if (options.catalogReference && asString(options.catalogReference.version)) {
    const reference = options.catalogReference;
    if (compareVersions(driver.driverVersion, reference.version) < 0) {
      return {
        level: 'update',
        source: 'catalog-package',
        latestVersion: reference.version,
        updateId: null,
        reason: `El paquete más reciente del catálogo para este hardware es ${reference.version}${
          reference.date ? ` (${formatDate(reference.date)})` : ''
        } y este equipo tiene ${driver.driverVersion}.`,
      };
    }
    return {
      level: 'current',
      source: 'catalog-package',
      latestVersion: reference.version,
      updateId: null,
      reason: `Última versión publicada en el catálogo: ${reference.version}${
        reference.date ? ` (${formatDate(reference.date)})` : ''
      }. La instalada es igual o posterior.`,
    };
  }

  const age = monthsSince(driver.driverDate, now);
  if (age !== null && age >= threshold) {
    return {
      level: 'current',
      source: 'age',
      latestVersion: null,
      updateId: null,
      reason: `Windows Update no ofrece nada más nuevo para este controlador (${formatDate(
        driver.driverDate,
      )}) y no hay una versión de referencia publicada.`,
    };
  }

  return {
    level: 'unknown',
    source: 'none',
    latestVersion: null,
    updateId: null,
    reason:
      age === null
        ? 'Sin fecha ni versión de referencia; no se puede afirmar si es el más reciente.'
        : `Controlador de ${formatDate(driver.driverDate)} (${age} meses) sin versión de referencia publicada en el catálogo.`,
  };
}

/**
 * Finds the catalog entry that describes a driver family. A pattern that fails to
 * compile is ignored instead of breaking the catalog (the file is user-editable).
 */
function matchCatalogEntry(driver, entries) {
  const name = asString(driver.deviceName);
  const haystack = `${name} ${asString(driver.provider)}`.toLowerCase();
  const deviceClass = asString(driver.classKey).toUpperCase();

  for (const entry of toArray(entries)) {
    if (!entry || typeof entry !== 'object') continue;
    let pattern = entry.pattern instanceof RegExp ? entry.pattern : null;
    if (!pattern && asString(entry.matchPattern)) {
      try {
        pattern = new RegExp(asString(entry.matchPattern), 'i');
      } catch {
        // A declared pattern that does not compile disqualifies the entry:
        // matching it blindly would apply the wrong reference version.
        continue;
      }
    }
    const entryClass = asString(entry.deviceClass).toUpperCase();
    if (entryClass && entryClass !== deviceClass) continue;
    if (asString(entry.vendor) && !haystack.includes(asString(entry.vendor).toLowerCase())) continue;
    if (pattern && !pattern.test(name)) continue;
    if (!entryClass && !asString(entry.vendor) && !pattern) continue;
    return entry;
  }
  return null;
}

function levelRank(level) {
  const index = LEVELS.indexOf(level);
  return index === -1 ? LEVELS.length : index;
}

module.exports = {
  LEVELS,
  toArray,
  asString,
  normalizeDate,
  normalizeHardwareIds,
  signature,
  hardwareIdsIntersect,
  compareVersions,
  hasNumericVersion,
  monthsSince,
  formatDate,
  isMicrosoftProvided,
  findMatchingUpdate,
  verdictFor,
  matchCatalogEntry,
  levelRank,
};
