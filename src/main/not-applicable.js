'use strict';

/**
 * Packages that were installed successfully by pnputil but that Windows never
 * bound to the device (the installed version did not change).
 *
 * The Catalog keeps offering them, so without this record the row would ask for
 * the same update forever. The record is tied to the current driver version: if
 * the version changes, the record stops applying.
 */

const fs = require('node:fs');
const path = require('node:path');
const paths = require('./paths');

const MAX_ENTRIES = 100;

function storeFile() {
  return path.join(paths.dataRoot(), 'no-aplica.json');
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
    /* el registro es una mejora */
  }
}

/**
 * @param {{ label?: string, hardwareIds: string[], currentVersion?: string, attemptedVersion?: string }} entry
 */
function record(entry) {
  const hardwareIds = (Array.isArray(entry.hardwareIds) ? entry.hardwareIds : []).filter(Boolean).map((id) => String(id).toLowerCase());
  if (hardwareIds.length === 0) return null;
  const saved = {
    at: new Date().toISOString(),
    label: String(entry.label || 'Controlador'),
    hardwareIds,
    currentVersion: String(entry.currentVersion || ''),
    attemptedVersion: String(entry.attemptedVersion || ''),
  };
  const entries = read().filter((existing) => !(existing.hardwareIds || []).some((id) => hardwareIds.includes(String(id).toLowerCase())));
  entries.push(saved);
  write(entries);
  return saved;
}

function remove(hardwareIds = []) {
  const ids = hardwareIds.map((id) => String(id).toLowerCase());
  const before = read();
  const after = before.filter((entry) => !(entry.hardwareIds || []).some((id) => ids.includes(String(id).toLowerCase())));
  if (after.length !== before.length) write(after);
}

/** Record that applies to the driver as it is installed right now. */
function match(driver, entries = read()) {
  const ids = (driver.hardwareIds || []).map((id) => String(id).toLowerCase());
  if (ids.length === 0) return null;
  const version = String(driver.driverVersion || '');
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry || !Array.isArray(entry.hardwareIds)) continue;
    if (!entry.hardwareIds.some((id) => ids.includes(String(id).toLowerCase()))) continue;
    if (String(entry.currentVersion || '') !== version) continue;
    return entry;
  }
  return null;
}

module.exports = { record, match, remove, read, storeFile };
