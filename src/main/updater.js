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
  autoUpdater.disableWebInstaller = true;
  // La descarga diferencial fallaba con "sha512 checksum mismatch" en cada
  // release y acababa descargando el instalador completo igualmente: se
  // desactiva para que el resultado sea siempre el mismo.
  autoUpdater.disableDifferentialDownload = true;

  // Development only: point the updater at a local latest.yml to exercise the
  // visual flow. Packaged builds always use the configured GitHub provider.
  if (!app.isPackaged && process.env.DUP_UPDATE_FEED) {
    autoUpdater.forceDevUpdateConfig = true;
    autoUpdater.setFeedURL({ provider: 'generic', url: process.env.DUP_UPDATE_FEED });
  }

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
    const message = error?.message || String(error);
    // A repository without releases is not a failure: it just means no updates.
    if (/no published versions/i.test(message)) {
      logger.info('update', 'El repositorio todavía no tiene versiones publicadas');
      send({ status: 'latest' });
      return;
    }
    logger.error('update', message);
    send({ status: 'error', message });
  });
}

function isSupported() {
  return app.isPackaged || (!app.isPackaged && Boolean(process.env.DUP_UPDATE_FEED));
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
