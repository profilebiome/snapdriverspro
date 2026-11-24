'use strict';

const paths = require('./paths');
const { runScript } = require('./powershell');
const catalogStore = require('./catalog');
const links = require('./links');
const verdict = require('./verdict');

function normalizeDriver(raw, index) {
  const hardwareIds = verdict.normalizeHardwareIds(raw.hardwareIds);
  const deviceId = verdict.asString(raw.deviceId);
  const infName = verdict.asString(raw.infName);
  const driverVersion = verdict.asString(raw.driverVersion);
  return {
    key: `${deviceId}|${infName}|${driverVersion}`.toLowerCase() || `driver-${index}`,
    deviceName: verdict.asString(raw.deviceName) || '(sin nombre)',
    deviceId,
    classKey: verdict.asString(raw.classKey).toUpperCase() || 'DESCONOCIDA',
    classGuid: verdict.asString(raw.classGuid),
    provider: verdict.asString(raw.provider),
    manufacturer: verdict.asString(raw.manufacturer),
    driverVersion,
    driverDate: verdict.normalizeDate(raw.driverDate),
    installDate: verdict.normalizeDate(raw.installDate),
    infName,
    isSigned: Boolean(raw.isSigned),
    signer: verdict.asString(raw.signer),
    status: verdict.asString(raw.status),
    errorCode: Number(raw.errorCode) || 0,
    hardwareIds,
    isSoftware: Boolean(raw.isSoftware),
    isPresent: raw.isPresent !== false,
  };
}

function normalizeProblem(raw, index) {
  return {
    key: `problem|${verdict.asString(raw.deviceId) || index}`.toLowerCase(),
    deviceName: verdict.asString(raw.deviceName) || '(dispositivo sin nombre)',
    deviceId: verdict.asString(raw.deviceId),
    classKey: verdict.asString(raw.classKey).toUpperCase() || 'DESCONOCIDA',
    classGuid: '',
    provider: '',
    manufacturer: '',
    driverVersion: '',
    driverDate: null,
    installDate: null,
    infName: '',
    isSigned: false,
    signer: '',
    status: verdict.asString(raw.status) || 'Error',
    errorCode: Number(raw.errorCode) || 0,
    hardwareIds: verdict.normalizeHardwareIds(raw.hardwareIds),
    isSoftware: false,
    isPresent: true,
    missingDriver: true,
  };
}

function normalizeUpdate(raw) {
  return {
    updateId: verdict.asString(raw.updateId),
    title: verdict.asString(raw.title),
    model: verdict.asString(raw.model),
    provider: verdict.asString(raw.provider),
    manufacturer: verdict.asString(raw.manufacturer),
    driverClass: verdict.asString(raw.driverClass),
    driverDate: verdict.normalizeDate(raw.driverDate),
    sizeBytes: Number(raw.sizeBytes) || 0,
    isMandatory: Boolean(raw.isMandatory),
    rebootRequired: Boolean(raw.rebootRequired),
    hardwareIds: verdict.normalizeHardwareIds(raw.hardwareIds),
  };
}

function findInstalledRecord(driver, records) {
  const ids = (driver.hardwareIds || []).map((id) => String(id).toLowerCase());
  if (ids.length === 0) return null;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (!record || !Array.isArray(record.hardwareIds)) continue;
    if (record.hardwareIds.some((id) => ids.includes(String(id).toLowerCase()))) return record;
  }
  return null;
}

function findVerifiedRecord(driver, records) {
  const ids = (driver.hardwareIds || []).map((id) => String(id).toLowerCase());
  if (ids.length === 0) return null;
  const version = String(driver.driverVersion || '');
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (!record || !Array.isArray(record.hardwareIds)) continue;
    if (!record.hardwareIds.some((id) => ids.includes(String(id).toLowerCase()))) continue;
    if (String(record.version || '') !== version) continue;
    return record;
  }
  return null;
}

function buildRow(driver, update, entry, system, settings, installedRecords = [], verifiedRecords = []) {
  const result = verdict.verdictFor(driver, update, entry, {
    ageThresholdMonths: settings.ageThresholdMonths,
    installedRecord: update ? null : findInstalledRecord(driver, installedRecords),
    verifiedRecord: update ? null : findVerifiedRecord(driver, verifiedRecords),
  });
  return {
    ...driver,
    installed: !driver.missingDriver,
    verdict: result,
    update: update
      ? {
          updateId: update.updateId,
          title: update.title,
          provider: update.provider,
          driverDate: update.driverDate,
          sizeBytes: update.sizeBytes,
          rebootRequired: update.rebootRequired,
        }
      : null,
    catalogEntry: entry
      ? {
          id: entry.id,
          latestVersion: entry.latestVersion,
          lastReviewed: entry.lastReviewed,
          origin: entry.origin,
          sourceUrl: entry.sourceUrl,
        }
      : null,
    links: links.resolveLinks(driver, system),
  };
}

/** Joins drivers + problems + Windows Update results into one row set. */
function buildRows({ system, drivers, problems, updates, catalogEntries, settings, installedRecords = [], verifiedRecords = [] }) {
  const entries = verdict.toArray(catalogEntries);
  const allUpdates = verdict.toArray(updates);
  const rows = [];
  const usedUpdateIds = new Set();

  for (const driver of verdict.toArray(drivers)) {
    const update = verdict.findMatchingUpdate(driver, allUpdates);
    if (update && update.updateId) usedUpdateIds.add(update.updateId);
    const entry = catalogStore.matchEntry(driver, entries);
    rows.push(buildRow(driver, update, entry, system, settings, installedRecords, verifiedRecords));
  }

  for (const problem of verdict.toArray(problems)) {
    const alreadyKnown = rows.some(
      (row) => row.deviceId && row.deviceId.toLowerCase() === problem.deviceId.toLowerCase(),
    );
    if (alreadyKnown) continue;
    const update = verdict.findMatchingUpdate(problem, allUpdates);
    if (update && update.updateId) usedUpdateIds.add(update.updateId);
    const row = buildRow(problem, update, null, system, settings, installedRecords, verifiedRecords);
    if (!update) {
      row.verdict = {
        level: 'error',
        source: 'none',
        latestVersion: null,
        updateId: null,
        reason: `Windows reporta el código de problema ${problem.errorCode}. Puede faltar el controlador.`,
      };
    }
    rows.push(row);
  }

  for (const update of allUpdates) {
    if (update.updateId && usedUpdateIds.has(update.updateId)) continue;
    const synthetic = {
      key: `wu|${update.updateId || update.title}`.toLowerCase(),
      deviceName: update.model || update.title || 'Actualización de controlador',
      deviceId: update.hardwareIds[0] || '',
      classKey: update.driverClass ? update.driverClass.toUpperCase() : 'DESCONOCIDA',
      classGuid: '',
      provider: update.provider,
      manufacturer: update.manufacturer,
      driverVersion: '',
      driverDate: null,
      installDate: null,
      infName: '',
      isSigned: false,
      signer: '',
      status: '',
      errorCode: 0,
      hardwareIds: update.hardwareIds,
      isSoftware: false,
      isPresent: false,
      missingDriver: true,
      orphanUpdate: true,
    };
    rows.push(buildRow(synthetic, update, null, system, settings, installedRecords, verifiedRecords));
  }

  rows.sort((a, b) => {
    const rank = verdict.levelRank(a.verdict.level) - verdict.levelRank(b.verdict.level);
    if (rank !== 0) return rank;
    return a.deviceName.localeCompare(b.deviceName, 'es');
  });
  return rows;
}

function summarize(rows, meta = {}) {
  const counts = { total: 0, updates: 0, errors: 0, review: 0, unknown: 0, current: 0 };
  for (const row of rows) {
    counts.total += 1;
    if (row.verdict.level === 'update') counts.updates += 1;
    else if (row.verdict.level === 'error') counts.errors += 1;
    else if (row.verdict.level === 'review') counts.review += 1;
    else if (row.verdict.level === 'current') counts.current += 1;
    else counts.unknown += 1;
  }
  return {
    ...counts,
    hardwareTotal: rows.filter((row) => !row.isSoftware).length,
    softwareTotal: rows.filter((row) => row.isSoftware).length,
    unsigned: rows.filter((row) => row.installed && row.isSigned === false && !row.orphanUpdate).length,
    ...meta,
  };
}

async function scanSystem(timeoutMs = 180_000) {
  const result = await runScript(paths.script('scan-system.ps1'), [], { timeoutMs });
  const parsed = JSON.parse(result.stdout);
  return {
    system: { ...(parsed.system || {}), hardware: parsed.hardware || {} },
    drivers: verdict.toArray(parsed.drivers).map(normalizeDriver),
    problems: verdict.toArray(parsed.problems).map(normalizeProblem),
    warnings: verdict.toArray(parsed.warnings),
    generatedAt: parsed.generatedAt || new Date().toISOString(),
    durationMs: Number(parsed.durationMs) || 0,
  };
}

async function scanWindowsUpdate(timeoutMs = 300_000) {
  const result = await runScript(paths.script('wu-drivers.ps1'), [], { timeoutMs });
  const parsed = JSON.parse(result.stdout);
  return {
    updates: verdict.toArray(parsed.updates).map(normalizeUpdate),
    available: Boolean(parsed.available),
    error: verdict.asString(parsed.error) || null,
    durationMs: Number(parsed.durationMs) || 0,
  };
}

module.exports = {
  scanSystem,
  scanWindowsUpdate,
  buildRows,
  summarize,
  normalizeDriver,
  normalizeUpdate,
  normalizeProblem,
};
