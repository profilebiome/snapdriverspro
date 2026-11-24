'use strict';

/**
 * Auto-update against the GitHub releases of the project.
 *
 * The updater is only active in packaged builds: in development there is no
 * `latest.yml`, so asking would only produce noise.
 */

const { app } = require('electron');
const { autoUpdater } = require('electron-updater');
const logger = require('./logger');

let initialized = false;
let getMainWindow = () => null;

function notesToText(notes) {
  if (!notes) return '';
  if (typeof notes === 'string') return notes.replace(/<[^>]+>/g, '').trim().slice(0, 1200);
  if (Array.isArray(notes)) {
    return notes
      .map((entry) => String(entry?.note || '').replace(/<[^>]+>/g, '').trim())
      .filter(Boolean)
      .join('\n')
      .slice(0, 1200);
  }
  return '';
}

function init({ getWindow }) {
  if (initialized) return;
  initialized = true;
  getMainWindow = getWindow || getMainWindow;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;

  const send = (payload) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send('update:event', payload);
  };

  autoUpdater.logger = {
    info: (message) => logger.info('update', String(message)),
    warn: (message) => logger.warn('update', String(message)),
    error: (message) => logger.error('update', String(message)),
    debug: () => {},
  };

  autoUpdater.on('checking-for-update', () => send({ status: 'checking' }));
  autoUpdater.on('update-available', (info) => {
    logger.info('update', `Actualización disponible: ${info?.version}`);
    send({
      status: 'available',
      version: info?.version || '',
      releaseDate: info?.releaseDate || null,
      notes: notesToText(info?.releaseNotes),
    });
  });
  autoUpdater.on('update-not-available', () => {
    logger.info('update', 'No hay versiones nuevas');
    send({ status: 'latest' });
  });
  autoUpdater.on('download-progress', (progress) =>
    send({
      status: 'downloading',
      percent: Math.max(0, Math.min(100, Math.round(Number(progress?.percent) || 0))),
      transferred: Number(progress?.transferred) || 0,
      total: Number(progress?.total) || 0,
    }),
  );
  autoUpdater.on('update-downloaded', (info) => send({ status: 'downloaded', version: info?.version || '' }));
  autoUpdater.on('error', (error) => {
    logger.error('update', error?.message || String(error));
    send({ status: 'error', message: error?.message || String(error) });
  });
}

function isSupported() {
  return app.isPackaged;
}

async function check() {
  if (!isSupported()) return { status: 'dev', version: app.getVersion() };
  init({ getWindow: getMainWindow });
  logger.info('update', 'Buscando actualizaciones');
  try {
    const result = await autoUpdater.checkForUpdates();
    return { status: 'checking', version: result?.updateInfo?.version || null };
  } catch (error) {
    logger.warn('update', `No se pudo comprobar: ${error.message}`);
    return { status: 'error', message: error.message };
  }
}

async function download() {
  if (!isSupported()) throw new Error('Las actualizaciones solo funcionan en la versión instalada.');
  init({ getWindow: getMainWindow });
  await autoUpdater.downloadUpdate();
  return { started: true };
}

function install() {
  if (!isSupported()) throw new Error('Las actualizaciones solo funcionan en la versión instalada.');
  // Close the windows first so the installer never fights a running process for
  // app.asar; a locked file is what leaves a half-written install behind.
  const win = getMainWindow();
  try {
    if (win && !win.isDestroyed()) win.destroy();
  } catch {
    /* seguimos igual */
  }
  setTimeout(() => {
    autoUpdater.quitAndInstall(true, true);
  }, 400);
  return { installing: true };
}

module.exports = { init, check, download, install, isSupported };
