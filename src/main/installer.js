'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { dialog, shell } = require('electron');
const paths = require('./paths');
const { runElevatedAndWait } = require('./elevate');
const installedStore = require('./installed');
const { classifyPnputil } = require('./pnputil');
const logger = require('./logger');
const scan = require('./scan');

/** Paths the user explicitly approved through a native dialog during this session. */
const approved = new Set();

/** Marks an app-created folder (catalog download) as safe to install from. */
function approve(target) {
  const resolved = path.resolve(String(target || ''));
  approved.add(resolved.toLowerCase());
  return resolved;
}

async function pickPackage(parentWindow) {
  const result = await dialog.showOpenDialog(parentWindow, {
    title: 'Elige el paquete de controlador descargado',
    buttonLabel: 'Usar este paquete',
    properties: ['openFile'],
    filters: [{ name: 'Paquete de controlador (*.inf)', extensions: ['inf'] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const file = path.resolve(result.filePaths[0]);
  approved.add(file.toLowerCase());
  return { path: file, name: path.basename(file), folder: path.dirname(file) };
}

async function pickFolder(parentWindow) {
  const result = await dialog.showOpenDialog(parentWindow, {
    title: 'Elige la carpeta descomprimida del controlador',
    buttonLabel: 'Usar esta carpeta',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const folder = path.resolve(result.filePaths[0]);
  approved.add(folder.toLowerCase());
  return { path: folder, name: path.basename(folder), folder };
}

function findInf(dir, depth = 0) {
  if (depth > 3) return false;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.inf')) return true;
    if (entry.isDirectory() && findInf(path.join(dir, entry.name), depth + 1)) return true;
  }
  return false;
}

function validateTarget(target) {
  const resolved = path.resolve(String(target || ''));
  if (!approved.has(resolved.toLowerCase())) {
    throw new Error('Solo se pueden instalar paquetes elegidos desde el botón «Elegir paquete».');
  }
  const stats = fs.statSync(resolved, { throwIfNoEntry: false });
  if (!stats) throw new Error('La ruta ya no existe. Vuelve a elegir el paquete.');

  if (stats.isDirectory()) {
    if (!findInf(resolved)) {
      throw new Error('La carpeta no contiene ningún archivo .inf. Descomprime el paquete del fabricante primero.');
    }
    return { resolved, kind: 'folder' };
  }

  if (path.extname(resolved).toLowerCase() !== '.inf') throw new Error('El archivo elegido no es un paquete .inf.');
  return { resolved, kind: 'file' };
}

async function createRestorePoint() {
  const result = await runElevatedAndWait(paths.script('restore-point.ps1'), [], { timeoutMs: 300_000 });
  return {
    ok: Boolean(result.ok),
    message: result.ok
      ? 'Punto de restauración creado.'
      : `No se pudo crear el punto de restauración: ${String(result.output || '').trim()}`,
  };
}

async function install(target, { restorePoint = true } = {}) {
  const { resolved, kind } = validateTarget(target);
  const steps = [];

  if (restorePoint) {
    try {
      const point = await createRestorePoint();
      steps.push({ step: 'restore-point', ...point });
    } catch (error) {
      steps.push({ step: 'restore-point', ok: false, message: error.message });
    }
  }

  let result;
  try {
    result = await runElevatedAndWait(paths.script('install-inf.ps1'), [resolved], { timeoutMs: 420_000 });
  } catch (error) {
    logger.error('install', `La instalación no pudo empezar: ${error.message}`, { target: resolved });
    throw error;
  }
  const output = String(result.output || '').trim();
  const outcome = classifyPnputil(result.exitCode);
  steps.push({ step: 'pnputil', ok: Boolean(result.ok), exitCode: result.exitCode, message: outcome.reason || output });
  logger.log(result.ok ? 'info' : 'error', 'install', `Instalación de ${path.basename(resolved)}: ${outcome.status}`, {
    target: resolved,
    exitCode: result.exitCode,
    status: outcome.status,
  });

  return {
    ok: Boolean(result.ok),
    kind,
    path: resolved,
    exitCode: Number(result.exitCode),
    warning: result.warning || null,
    status: result.status || outcome.status,
    rebootRequired: Boolean(result.rebootRequired) || outcome.rebootRequired,
    installed: Number(result.installed) || 0,
    failed: Number(result.failed) || 0,
    output,
    steps,
    rebootHint: /reinici|restart|reboot/i.test(output),
  };
}

/** Installs several extracted packages with a single elevation prompt. */
async function installBatch(targets, { restorePoint = false, onProgress = null } = {}) {
  const items = [];
  for (const target of Array.isArray(targets) ? targets : []) {
    const { resolved, kind } = validateTarget(target.path || target);
    items.push({
      label: String(target.label || path.basename(resolved)),
      path: resolved,
      kind,
      hardwareIds: Array.isArray(target.hardwareIds) ? target.hardwareIds.map(String).slice(0, 12) : [],
      previousVersion: String(target.previousVersion || ''),
    });
  }
  if (items.length === 0) throw new Error('No hay paquetes para instalar.');

  const steps = [];
  if (restorePoint) {
    try {
      const point = await createRestorePoint();
      steps.push({ step: 'restore-point', ...point });
    } catch (error) {
      steps.push({ step: 'restore-point', ok: false, message: error.message });
    }
  }

  const manifest = path.join(os.tmpdir(), `dup-batch-${Date.now()}.json`);
  fs.writeFileSync(
    manifest,
    JSON.stringify(items.map((item) => ({ label: item.label, path: item.path, hardwareIds: item.hardwareIds }))),
    'utf8',
  );
  try {
    const progressFile = path.join(os.tmpdir(), `dup-progress-${Date.now()}.json`);
    let progressTimer = null;
    if (typeof onProgress === 'function') {
      progressTimer = setInterval(() => {
        try {
          if (!fs.existsSync(progressFile)) return;
          const entries = JSON.parse(fs.readFileSync(progressFile, 'utf8').replace(/^﻿/, ''));
          if (Array.isArray(entries)) onProgress(entries);
        } catch {
          /* el archivo se está escribiendo */
        }
      }, 700);
    }
    let result;
    try {
      result = await runElevatedAndWait(paths.script('install-batch.ps1'), [manifest, progressFile], { timeoutMs: 480_000 });
    } catch (error) {
      logger.error('install', `La instalación no pudo empezar: ${error.message}`, { packages: items.length });
      throw error;
    } finally {
      if (progressTimer) clearInterval(progressTimer);
      try {
        fs.unlinkSync(progressFile);
      } catch {
        /* temporal */
      }
    }
    const results = Array.isArray(result.results) ? result.results : [];

    // pnputil can report success while the device keeps its previous driver until
    // a reboot. Re-read the real version so the UI never claims an update that
    // Windows has not applied yet.
    let currentVersions = new Map();
    if (results.some((item) => item.ok)) {
      try {
        const scanned = await scan.scanSystem(90_000);
        for (const item of items) {
          const match = scanned.drivers.find(
            (driver) =>
              Array.isArray(driver.hardwareIds) &&
              driver.hardwareIds.some((id) => item.hardwareIds.map((x) => x.toLowerCase()).includes(String(id).toLowerCase())),
          );
          if (match) currentVersions.set(item.path, match.driverVersion);
        }
      } catch (error) {
        logger.warn('install', `No se pudo comprobar la versión tras instalar: ${error.message}`);
      }
    }

    const mapped = results.map((item) => {
      const outcome = classifyPnputil(item.exitCode);
      const previous = items.find((entry) => entry.path === item.path)?.previousVersion || '';
      const currentVersion = currentVersions.get(item.path) || '';
      const applied = Boolean(currentVersion) && Boolean(previous) && currentVersion !== previous;
      const needsReboot = Boolean(item.ok) && Boolean(currentVersion) && Boolean(previous) && !applied;
      return {
        ...item,
        currentVersion,
        applied,
        needsReboot,
        status: item.status || outcome.status,
        reason: outcome.reason,
        rebootRequired: Boolean(item.rebootRequired) || outcome.rebootRequired,
      };
    });
    for (const item of mapped) {
      if (item.ok && (item.status === 'ok' || item.status === 'reboot')) {
        installedStore.record({
          label: item.label,
          hardwareIds: items.find((entry) => entry.path === item.path)?.hardwareIds || [],
          infs: item.infs,
          status: item.status,
        });
      }
      logger.log(
        item.ok ? (item.status === 'ok' ? 'info' : 'warn') : 'error',
        'install',
        `${item.label}: ${item.status} (pnputil ${item.exitCode})`,
        { path: item.path, codes: item.codes, added: item.added, infs: item.infs },
      );
    }
    logger.info('install', `Lote terminado: ${mapped.filter((item) => item.ok).length} correctos, ${mapped.filter((item) => !item.ok).length} con error`, {
      scanDevices: result.scanDevices,
      rebootRequired: Boolean(result.rebootRequired),
    });
    return {
      ok: Boolean(result.ok) && mapped.every((item) => item.ok),
      results: mapped,
      steps,
      rebootRequired: Boolean(result.rebootRequired),
      scanDevices: result.scanDevices || null,
      installed: mapped.filter((item) => item.ok).length,
      failed: mapped.filter((item) => !item.ok).length,
    };
  } finally {
    try {
      fs.unlinkSync(manifest);
    } catch {
      /* temporal */
    }
  }
}

function openDeviceManager() {
  return new Promise((resolve, reject) => {
    execFile('mmc.exe', ['devmgmt.msc'], { windowsHide: false }, (error) => {
      if (error) reject(error);
      else resolve(true);
    });
  });
}

async function openFolder(target) {
  const errorMessage = await shell.openPath(target);
  if (errorMessage) throw new Error(errorMessage);
  return true;
}

module.exports = {
  pickPackage,
  pickFolder,
  install,
  installBatch,
  createRestorePoint,
  openDeviceManager,
  openFolder,
  approve,
  approvedRoots: approved,
};
