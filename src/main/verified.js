'use strict';

/**
 * Drivers the user has checked by hand and marked as up to date.
 *
 * The age rule marks any third-party driver older than the threshold as
 * "revisar" because there is no reference version; this file is the honest way
 * to close that loop: the user confirms it against the vendor page and the row
 * becomes "al día · verificado" for that exact version.
 */

const fs = require('node:fs');
const path = require('node:path');
const paths = require('./paths');

const MAX_ENTRIES = 300;

function storeFile() {
  return path.join(paths.dataRoot(), 'verificados.json');
}

function read() {
  try {
    const data = JSON.parse(fs.readFileSync(storeFile(), 'utf8').replace(/^\uFEFF/, ''));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function write(entries) {
  try {
    fs.writeFileSync(storeFile(), JSON.stringify(entries.slice(-MAX_ENTRIES), null, 2), 'utf8');
  } catch {
    /* el registro es una mejora, no un requisito */
  }
}

/**
 * @param {{ hardwareIds: string[], version?: string, label?: string }} entry
 */
function record(entry) {
  const hardwareIds = (Array.isArray(entry.hardwareIds) ? entry.hardwareIds : []).filter(Boolean).map((id) => String(id).toLowerCase());
  if (hardwareIds.length === 0) return null;
  const saved = {
    at: new Date().toISOString(),
    label: String(entry.label || 'Controlador'),
    hardwareIds,
    version: String(entry.version || ''),
  };
  const entries = read().filter((existing) => !(existing.hardwareIds || []).some((id) => hardwareIds.includes(String(id).toLowerCase())));
  entries.push(saved);
  write(entries);
  return saved;
}

/**
 * Latest verification that covers the driver and its current version. A version
 * change invalidates the record: the user verified a different binary.
 */
function match(driver, entries = read()) {
  const ids = (driver.hardwareIds || []).map((id) => String(id).toLowerCase());
  if (ids.length === 0) return null;
  const version = String(driver.driverVersion || '');
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry || !Array.isArray(entry.hardwareIds)) continue;
    if (!entry.hardwareIds.some((id) => ids.includes(String(id).toLowerCase()))) continue;
    if (String(entry.version || '') !== version) continue;
    return entry;
  }
  return null;
}

module.exports = { record, match, read, storeFile };
