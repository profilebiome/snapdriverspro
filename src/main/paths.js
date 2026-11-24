'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const APP_FOLDER_NAME = 'SnapDriversPro';
const LEGACY_FOLDERS = ['DriversUpdatePro'];
const LEGACY_PROFILES = ['Drivers Update Pro'];

/** Portable builds get PORTABLE_EXECUTABLE_DIR from the electron-builder wrapper. */
const portableDir = process.env.PORTABLE_EXECUTABLE_DIR || null;

let cachedRoot = null;

/** Node reads through asar, but PowerShell cannot: scripts live unpacked. */
function asarUnpacked(target) {
  return String(target).replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
}

/** Copies settings/catalog/downloads from an older install the first time. */
function migrateFrom(targetDir) {
  try {
    if (fs.existsSync(path.join(targetDir, 'settings.json'))) return;
    const sources = [];
    if (portableDir) for (const legacy of LEGACY_FOLDERS) sources.push(path.join(portableDir, legacy));
    const roaming = app.getPath('appData');
    for (const legacy of LEGACY_PROFILES) sources.push(path.join(roaming, legacy));
    for (const source of sources) {
      if (!source || source === targetDir || !fs.existsSync(source)) continue;
      fs.cpSync(source, targetDir, { recursive: true });
      return;
    }
  } catch {
    /* migrar es una comodidad, no un requisito */
  }
}

function isWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.write-probe');
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * Portable mode keeps everything next to the .exe. If that folder is read-only
 * (Program Files, a locked USB), it falls back to the user profile instead of
 * crashing on the first write.
 */
function dataRoot() {
  if (cachedRoot) return cachedRoot;
  const candidates = [];
  if (portableDir) candidates.push(path.join(portableDir, APP_FOLDER_NAME));
  candidates.push(app.getPath('userData'));
  candidates.push(path.join(app.getPath('userData'), APP_FOLDER_NAME));

  for (const candidate of candidates) {
    if (isWritable(candidate)) {
      migrateFrom(candidate);
      cachedRoot = candidate;
      return candidate;
    }
  }
  cachedRoot = app.getPath('temp');
  return cachedRoot;
}

function reportsDir() {
  const dir = path.join(dataRoot(), 'Informes');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function downloadsDir() {
  const dir = path.join(dataRoot(), 'Descargas');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function script(name) {
  return asarUnpacked(path.join(__dirname, 'scripts', name));
}

function bundledCatalog() {
  return path.join(app.getAppPath(), 'data', 'latest-versions.json');
}

function userCatalog() {
  return path.join(dataRoot(), 'catalog.json');
}

function settingsFile() {
  return path.join(dataRoot(), 'settings.json');
}

function isPortable() {
  return Boolean(portableDir);
}

module.exports = {
  APP_FOLDER_NAME,
  asarUnpacked,
  dataRoot,
  reportsDir,
  downloadsDir,
  script,
  bundledCatalog,
  userCatalog,
  settingsFile,
  isPortable,
};
