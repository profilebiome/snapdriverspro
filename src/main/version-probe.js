'use strict';

/**
 * Real version reference from the Microsoft Update Catalog.
 *
 * For a device with no catalog family and no Windows Update offer, the app can
 * download the package Microsoft publishes for that hardware ID, read the
 * `DriverVer` inside its INF and compare it with what is installed. That turns
 * "sin referencia" into an evidence-backed verdict, and the result is cached so
 * later scans compare automatically.
 */

const fs = require('node:fs');
const path = require('node:path');
const paths = require('./paths');
const downloads = require('./catalog-download');
const logger = require('./logger');

const MAX_BYTES = 80 * 1024 * 1024;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function cacheFile() {
  return path.join(paths.dataRoot(), 'versiones.json');
}

function readCache() {
  try {
    const data = JSON.parse(fs.readFileSync(cacheFile(), 'utf8').replace(/^\uFEFF/, ''));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function writeCache(data) {
  try {
    fs.writeFileSync(cacheFile(), JSON.stringify(data, null, 2), 'utf8');
  } catch {
    /* la caché es una mejora */
  }
}

function idsOf(row) {
  return (row.hardwareIds || []).map((id) => String(id).toLowerCase()).filter(Boolean);
}

/** Cached reference for a row (fresh within a week), or null. */
function referenceFor(row, cache = readCache()) {
  const ids = idsOf(row);
  for (const id of ids) {
    const entry = cache[id];
    if (entry && Number.isFinite(entry.at) && Date.now() - entry.at < TTL_MS && entry.version) return entry;
  }
  return null;
}

function readInfText(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.length > 1 && buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.toString('utf16le');
  let text = buffer.toString('utf8');
  if (text.includes('\u0000')) text = buffer.toString('utf16le');
  return text.replace(/^\uFEFF/, '');
}

function highestDriverVer(infs) {
  let best = null;
  for (const inf of infs) {
    let text = '';
    try {
      text = readInfText(inf);
    } catch {
      continue;
    }
    const match = text.match(/DriverVer\s*=\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})\s*,\s*([0-9][0-9.]*)/i);
    if (!match) continue;
    if (!best || Number(match[2].split('.').join('')) > Number(best.version.split('.').join(''))) {
      const [month, day, year] = match[1].split('/');
      best = { version: match[2], date: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`, inf: path.basename(inf) };
    }
  }
  return best;
}

function pickCandidate(results) {
  const score = (item) => {
    let value = 0;
    if (/windows 1[01]|windows next/i.test(item.products || '')) value += 4;
    if (/driver/i.test(item.classification || '')) value += 1;
    value += Math.min(3, (item.sizeBytes || 0) / (200 * 1024 * 1024));
    return value;
  };
  return [...(results || [])].sort((a, b) => score(b) - score(a) || (b.sizeBytes || 0) - (a.sizeBytes || 0))[0] || null;
}

/**
 * Downloads the catalog package for a row, reads the INF version and caches it.
 * Returns { found, version, date, sizeBytes, title } or { skipped, reason }.
 */
async function probe(row) {
  const query = row.links?.catalogQuery || (row.hardwareIds || [])[0];
  if (!query) return { found: false, reason: 'Este dispositivo no tiene hardware ID.' };

  const variants = [query, ...(row.hardwareIds || []).slice(0, 3)];
  const search = await downloads.search(variants[0], variants.slice(1));
  if (!search.results || search.results.length === 0) return { found: false, reason: 'Microsoft no publica paquetes para este dispositivo.' };

  const best = pickCandidate(search.results);
  if (!best) return { found: false, reason: 'Sin paquetes utilizables.' };
  if (best.sizeBytes && best.sizeBytes > MAX_BYTES) {
    return { found: false, skipped: true, sizeBytes: best.sizeBytes, reason: 'El paquete supera el límite de comprobación (80 MB).' };
  }

  const urls = await downloads.resolveUrls(best.updateId);
  const label = `comprobacion-${String(row.deviceName || 'driver').slice(0, 40)}`;
  const file = await downloads.downloadFile(urls[0], { label, jobId: `probe-${Date.now()}`, maxBytes: MAX_BYTES });
  let extracted = null;
  try {
    extracted = await downloads.expandCab(file.path);
    const best2 = highestDriverVer(extracted.infs);
    if (!best2) return { found: false, reason: 'El paquete no declara una versión de controlador.' };

    const reference = {
      at: Date.now(),
      version: best2.version,
      date: best2.date,
      sizeBytes: file.sizeBytes,
      title: best.title,
      updateId: best.updateId,
      hardwareId: String(query),
    };
    const cache = readCache();
    for (const id of idsOf(row)) cache[id] = reference;
    writeCache(cache);
    logger.info('catalog', `Versión de referencia ${reference.version} (${reference.date}) para ${row.deviceName}`, {
      package: best.title,
      sizeBytes: file.sizeBytes,
    });
    return { found: true, ...reference };
  } finally {
    try {
      fs.rmSync(file.path, { force: true });
    } catch {
      /* temporal */
    }
    if (extracted) {
      try {
        fs.rmSync(extracted.dir, { recursive: true, force: true });
      } catch {
        /* temporal */
      }
    }
  }
}

module.exports = { probe, referenceFor, readCache, highestDriverVer, MAX_BYTES };
