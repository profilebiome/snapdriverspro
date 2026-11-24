'use strict';

const fs = require('node:fs');
const paths = require('./paths');
const { asString, toArray, matchCatalogEntry } = require('./verdict');

const SCHEMA = 1;

function sanitizeEntry(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  const id = asString(raw.id) || `entrada-${index + 1}`;
  let pattern = null;
  if (asString(raw.matchPattern)) {
    try {
      pattern = new RegExp(asString(raw.matchPattern), 'i');
    } catch {
      pattern = null;
    }
  }
  return {
    id,
    vendor: asString(raw.vendor),
    deviceClass: asString(raw.deviceClass).toUpperCase(),
    matchPattern: asString(raw.matchPattern),
    latestVersion: asString(raw.latestVersion) || null,
    lastReviewed: asString(raw.lastReviewed) || null,
    sourceUrl: asString(raw.sourceUrl),
    notes: asString(raw.notes),
    pattern,
  };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function load() {
  const bundled = readJson(paths.bundledCatalog()) || { schema: SCHEMA, entries: [] };
  const user = readJson(paths.userCatalog());

  const entries = new Map();
  for (const [index, raw] of toArray(bundled.entries).entries()) {
    const entry = sanitizeEntry({ ...raw, origin: 'incluido' }, index);
    if (entry) entries.set(entry.id, { ...entry, origin: 'incluido' });
  }
  for (const [index, raw] of toArray(user?.entries).entries()) {
    const entry = sanitizeEntry({ ...raw, origin: 'usuario' }, index);
    if (entry) entries.set(entry.id, { ...entry, origin: 'usuario' });
  }

  return {
    schema: SCHEMA,
    updatedAt: asString(user?.updatedAt) || asString(bundled.updatedAt) || null,
    hasUserOverride: Boolean(user),
    entries: [...entries.values()],
  };
}

function matchEntry(driver, entries) {
  return matchCatalogEntry(driver, entries);
}

function saveUserCatalog(entries) {
  const payload = {
    schema: SCHEMA,
    updatedAt: new Date().toISOString().slice(0, 10),
    note: 'Catálogo editable de Snap Drivers Pro. Añade la última versión conocida de cada familia para activar la comparación por versión.',
    entries: toArray(entries).map((entry, index) => ({
      id: asString(entry.id) || `entrada-${index + 1}`,
      vendor: asString(entry.vendor),
      deviceClass: asString(entry.deviceClass).toUpperCase(),
      matchPattern: asString(entry.matchPattern),
      latestVersion: asString(entry.latestVersion) || null,
      lastReviewed: asString(entry.lastReviewed) || null,
      sourceUrl: asString(entry.sourceUrl),
      notes: asString(entry.notes),
    })),
  };
  fs.writeFileSync(paths.userCatalog(), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return load();
}

module.exports = { load, matchEntry, saveUserCatalog, SCHEMA };
