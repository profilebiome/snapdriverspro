'use strict';

/**
 * Remembers which packages this app installed, so a later scan can say
 * "al día · instalado por Snap Drivers Pro" instead of "revisar" for a driver
 * that is simply older than the reference threshold.
 */

const fs = require('node:fs');
const path = require('node:path');
const paths = require('./paths');

const MAX_ENTRIES = 200;
const FRESH_DAYS = 180;

function storeFile() {
  return path.join(paths.dataRoot(), 'instalados.json');
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
 * @param {{ label: string, hardwareIds: string[], infs?: number, status?: string }} entry
 */
function record(entry) {
  const hardwareIds = Array.isArray(entry.hardwareIds) ? entry.hardwareIds.filter(Boolean) : [];
  if (hardwareIds.length === 0) return null;
  const saved = {
    at: new Date().toISOString(),
    label: String(entry.label || 'Paquete'),
    hardwareIds: hardwareIds.map((id) => String(id).toLowerCase()),
    infs: Number(entry.infs) || 0,
    status: String(entry.status || 'ok'),
  };
  const entries = read();
  entries.push(saved);
  write(entries);
  return saved;
}

/**
 * Latest install record that covers any hardware ID of the driver.
 */
function match(driver, entries = read()) {
  const ids = (driver.hardwareIds || []).map((id) => String(id).toLowerCase());
  if (ids.length === 0) return null;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry || !Array.isArray(entry.hardwareIds)) continue;
    if (entry.hardwareIds.some((id) => ids.includes(id))) return entry;
  }
  return null;
}

function isFresh(entry, now = new Date()) {
  if (!entry || !entry.at) return false;
  const at = new Date(entry.at);
  if (Number.isNaN(at.getTime())) return false;
  return now.getTime() - at.getTime() <= FRESH_DAYS * 24 * 60 * 60 * 1000;
}

module.exports = { record, match, read, isFresh, storeFile, FRESH_DAYS };
