'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, ipcMain, shell, dialog } = require('electron');
const paths = require('./paths');
const settingsStore = require('./settings');
const catalogStore = require('./catalog');
const scan = require('./scan');
const installer = require('./installer');
const links = require('./links');
const report = require('./report');
const powershell = require('./powershell');
const downloads = require('./catalog-download');
const logger = require('./logger');
const installedStore = require('./installed');
const elevate = require('./elevate');
const updater = require('./updater');

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** Last catalog search per row, so a download can only use an update from that list. */
const searchCache = new Map();
const downloadJobs = new Map();
const { isAllowedUrl } = require('./links');

const session = {
  rows: [],
  system: {},
  stats: null,
  catalog: null,
  generatedAt: null,
  scanning: false,
  scanToken: 0,
};

/** Cheap host facts available before the first scan (no WMI round-trip). */
function hostInfo() {
  const cpus = os.cpus();
  return {
    hostname: os.hostname(),
    osVersion: typeof process.getSystemVersion === 'function' ? process.getSystemVersion() : '',
    arch: process.arch === 'x64' ? 'x64' : process.arch,
    osArch: typeof os.machine === 'function' ? os.machine() : os.arch(),
    windowsBuild: Number(process.getSystemVersion?.().split('.')[2]) || 0,
    ramGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    cpu: (cpus[0]?.model || '').replace(/\s+/g, ' ').trim(),
  };
}

function pendingFile() {
  return path.join(paths.dataRoot(), 'pendiente.json');
}

function lastScanFile() {
  return path.join(paths.dataRoot(), 'ultimo-escaneo.json');
}

function loadLastScan() {
  try {
    const raw = JSON.parse(fs.readFileSync(lastScanFile(), 'utf8').replace(/^\uFEFF/, ''));
    if (!Array.isArray(raw.rows)) return null;
    return raw;
  } catch {
    return null;
  }
}

function persistScan() {
  try {
    fs.writeFileSync(
      lastScanFile(),
      JSON.stringify({
        generatedAt: session.generatedAt,
        system: session.system,
        stats: session.stats,
        rows: session.rows,
      }),
      'utf8',
    );
  } catch {
    /* el informe es un extra: si falla, no rompe el escaneo */
  }
}

function publicCatalog(catalog) {
  return {
    schema: catalog.schema,
    updatedAt: catalog.updatedAt,
    hasUserOverride: catalog.hasUserOverride,
    entries: catalog.entries.map((entry) => ({
      id: entry.id,
      vendor: entry.vendor,
      deviceClass: entry.deviceClass,
      matchPattern: entry.matchPattern,
      latestVersion: entry.latestVersion,
      lastReviewed: entry.lastReviewed,
      sourceUrl: entry.sourceUrl,
      notes: entry.notes,
      origin: entry.origin,
    })),
  };
}

function ok(data) {
  return { ok: true, data };
}

function fail(error) {
  const message = error instanceof Error ? error.message : String(error);
  return { ok: false, error: message };
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return ok(await fn(event, ...args));
    } catch (error) {
      return fail(error);
    }
  });
}

function rowsByKey(keys) {
  const wanted = new Set((Array.isArray(keys) ? keys : [keys]).map(String));
  return session.rows.filter((row) => wanted.has(row.key));
}

async function openUrl(rawUrl) {
  if (!isAllowedUrl(rawUrl)) throw new Error('Enlace no permitido.');
  await shell.openExternal(rawUrl);
}

function register({ getWindow }) {
  const send = (payload) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('scan:event', payload);
  };

  handle('app:bootstrap', async () => {
    const settings = settingsStore.load();
    const catalog = catalogStore.load();
    session.catalog = catalog;
    const previous = loadLastScan();
    if (previous && session.rows.length === 0) {
      session.rows = previous.rows;
      session.system = previous.system || {};
      session.stats = previous.stats || null;
      session.generatedAt = previous.generatedAt || null;
    }
    return {
      version: app.getVersion(),
      isPortable: paths.isPortable(),
      elevated: await elevate.isElevated(),
      dataRoot: paths.dataRoot(),
      reportsDir: paths.reportsDir(),
      settings,
      catalog: publicCatalog(catalog),
      host: hostInfo(),
      previous,
    };
  });

  handle('scan:start', async () => {
    if (session.scanning) throw new Error('Ya hay un escaneo en curso.');
    session.scanning = true;
    const token = ++session.scanToken;

    (async () => {
      const started = Date.now();
      try {
        send({ type: 'phase', phase: 'devices', message: 'Leyendo dispositivos del sistema…' });
        logger.info('scan', 'Escaneo iniciado');
        const systemResult = await scan.scanSystem();
        logger.info('scan', `Dispositivos leídos: ${systemResult.drivers.length} controladores, ${systemResult.problems.length} con problema`, {
          warnings: systemResult.warnings,
        });
        if (token !== session.scanToken) return;

        const settings = settingsStore.load();
        const catalog = catalogStore.load();
        const installedRecords = installedStore.read().filter((entry) => installedStore.isFresh(entry));
        const partialRows = scan.buildRows({
          system: systemResult.system,
          drivers: systemResult.drivers,
          problems: systemResult.problems,
          updates: [],
          catalogEntries: catalog.entries,
          settings,
          installedRecords,
        });
        session.rows = partialRows;
        session.system = systemResult.system;
        session.stats = scan.summarize(partialRows, { updatesAvailable: false });
        send({
          type: 'partial',
          system: systemResult.system,
          rows: partialRows,
          stats: session.stats,
          warnings: systemResult.warnings,
        });

        send({ type: 'phase', phase: 'updates', message: 'Consultando Windows Update…' });
        let updateResult = { updates: [], available: false, error: null, durationMs: 0 };
        try {
          updateResult = await scan.scanWindowsUpdate();
        } catch (error) {
          updateResult.error = error.message;
        }
        logger.log(updateResult.error ? 'warn' : 'info', 'windows-update', updateResult.error || `${updateResult.updates.length} actualizaciones de driver ofrecidas`);
        if (token !== session.scanToken) return;

        send({ type: 'phase', phase: 'merge', message: 'Cruzando versiones y fuentes oficiales…' });
        const rows = scan.buildRows({
          system: systemResult.system,
          drivers: systemResult.drivers,
          problems: systemResult.problems,
          updates: updateResult.updates,
          catalogEntries: catalog.entries,
          settings,
          installedRecords,
        });
        const stats = scan.summarize(rows, {
          updatesAvailable: updateResult.available,
          windowsUpdateError: updateResult.error,
          windowsUpdateCount: updateResult.updates.length,
          durationMs: Date.now() - started,
          scannedAt: new Date().toISOString(),
          ageThresholdMonths: settings.ageThresholdMonths,
          catalogEntries: catalog.entries.length,
          catalogVersioned: catalog.entries.filter((entry) => entry.latestVersion).length,
        });

        session.rows = rows;
        session.stats = stats;
        session.generatedAt = stats.scannedAt;
        session.catalog = catalog;
        settingsStore.save({ lastScanAt: stats.scannedAt });
        persistScan();

        logger.info('scan', `Escaneo completo: ${stats.updates} actualizaciones, ${stats.total} filas`, {
          durationMs: stats.durationMs,
          windowsUpdateError: stats.windowsUpdateError,
        });
        send({
          type: 'complete',
          system: systemResult.system,
          rows,
          stats,
          warnings: systemResult.warnings,
          catalog: publicCatalog(catalog),
        });
      } catch (error) {
        if (token !== session.scanToken) return;
        logger.error('scan', error instanceof Error ? error.message : String(error));
        send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      } finally {
        if (token === session.scanToken) session.scanning = false;
      }
    })();

    return { started: true };
  });

  handle('scan:cancel', async () => {
    session.scanToken += 1;
    session.scanning = false;
    powershell.killAll();
    return { cancelled: true };
  });

  handle('links:open', async (_event, { rowKey, which } = {}) => {
    const row = rowsByKey(rowKey)[0];
    if (!row) throw new Error('Ese controlador ya no está en la lista. Vuelve a escanear.');
    const table = {
      chip: row.links?.vendor?.url,
      vendor: row.links?.vendor?.url,
      oem: row.links?.oem?.url,
      catalog: row.links?.catalogUrl,
      wu: row.links?.windowsUpdateUrl,
      windowsupdate: row.links?.windowsUpdateUrl,
    };
    const url = table[String(which || '')];
    if (!url) throw new Error('Este controlador no tiene enlace para esa acción.');
    await openUrl(url);
    return { url };
  });

  handle('links:openMany', async (_event, { rowKeys, which = 'catalog' } = {}) => {
    const rows = rowsByKey(rowKeys).slice(0, 12);
    const urls = [];
    for (const row of rows) {
      const url = which === 'vendor' ? row.links?.vendor?.url : row.links?.catalogUrl;
      if (url && !urls.includes(url)) urls.push(url);
    }
    for (const url of urls) {
      if (!isAllowedUrl(url)) continue;
      await shell.openExternal(url);
      await new Promise((resolve) => setTimeout(resolve, 260));
    }
    return { opened: urls.length, skipped: rows.length - urls.length };
  });

  handle('installer:pick', async (event) => {
    const win = getWindow();
    return installer.pickPackage(win);
  });

  handle('installer:pickFolder', async () => {
    const win = getWindow();
    return installer.pickFolder(win);
  });

  handle('installer:run', async (_event, { target, restorePoint } = {}) => {
    if (!(await elevate.isElevated())) return { needsElevation: true };
    return installer.install(target, { restorePoint });
  });

  handle('installer:runBatch', async (_event, { targets, restorePoint } = {}) => {
    if (!(await elevate.isElevated())) return { needsElevation: true };
    return installer.installBatch(targets, { restorePoint });
  });

  handle('app:isElevated', async () => ({ elevated: await elevate.isElevated() }));

  handle('updates:check', async () => updater.check());
  handle('updates:download', async () => updater.download());
  handle('updates:install', async () => updater.install());
  handle('updates:info', async () => ({ version: app.getVersion(), supported: updater.isSupported() }));

  handle('app:relaunchElevated', async () => {
    const exe = app.isPackaged ? process.env.PORTABLE_EXECUTABLE_FILE || process.execPath : process.execPath;
    const extra = app.isPackaged ? '' : ` -ArgumentList '${app.getAppPath().replace(/'/g, "''")}'`;
    const command = `Start-Process -FilePath '${String(exe).replace(/'/g, "''")}' -Verb RunAs`;
    const child = spawn(
      path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', command + extra],
      { detached: true, stdio: 'ignore', windowsHide: true },
    );
    child.unref();
    setTimeout(() => app.quit(), 400);
    return { relaunching: true };
  });

  handle('pending:save', async (_event, payload) => {
    fs.writeFileSync(pendingFile(), JSON.stringify(payload || {}, null, 2), 'utf8');
    return { saved: true };
  });

  handle('pending:take', async () => {
    try {
      if (!fs.existsSync(pendingFile())) return null;
      const raw = JSON.parse(fs.readFileSync(pendingFile(), 'utf8').replace(/^\uFEFF/, ''));
      fs.unlinkSync(pendingFile());
      // The folders were created by this app inside Descargas before the elevated
      // restart, so they are re-approved here instead of asking again.
      for (const item of Array.isArray(raw?.items) ? raw.items : []) {
        const candidate = path.resolve(String(item?.path || ''));
        if (isInside(paths.downloadsDir(), candidate) && fs.existsSync(candidate)) installer.approve(candidate);
      }
      return raw;
    } catch {
      return null;
    }
  });

  handle('installer:deviceManager', async () => {
    await installer.openDeviceManager();
    return true;
  });

  handle('report:export', async (_event, { format = 'html' } = {}) => {
    if (!session.stats || session.rows.length === 0) throw new Error('Primero hay que escanear el equipo.');
    const win = getWindow();
    const result = await report.exportReport(
      win,
      {
        rows: session.rows,
        stats: session.stats,
        system: session.system,
        catalog: publicCatalog(session.catalog || catalogStore.load()),
        generatedAt: session.generatedAt,
      },
      format,
    );
    return result;
  });

  handle('settings:save', async (_event, patch) => settingsStore.save(patch || {}));

  handle('catalog:get', async () => publicCatalog(catalogStore.load()));

  handle('catalog:save', async (_event, entries) => {
    if (!Array.isArray(entries)) throw new Error('El catálogo debe ser una lista de entradas.');
    if (entries.length > 500) throw new Error('El catálogo admite como máximo 500 entradas.');
    const saved = catalogStore.saveUserCatalog(entries);
    session.catalog = saved;
    return publicCatalog(saved);
  });

  handle('downloads:search', async (_event, { rowKey } = {}) => {
    const row = rowsByKey(rowKey)[0];
    if (!row) throw new Error('Ese controlador ya no está en la lista. Vuelve a escanear.');
    const canonical = row.links?.catalogQuery || '';
    const variants = [canonical, ...(row.hardwareIds || []).slice(0, 3)].filter(Boolean);
    if (variants.length === 0) throw new Error('Este dispositivo no tiene hardware ID para buscar en el catálogo.');
    const result = await downloads.search(variants[0], variants.slice(1));
    searchCache.set(rowKey, { ids: new Set(result.results.map((item) => item.updateId)), at: Date.now() });
    logger.log(
      result.results.length ? (result.stale ? 'warn' : 'info') : 'warn',
      'catalog',
      `${row.deviceName}: ${result.results.length} paquete(s)${result.stale ? ' (caché)' : ''}${result.blocked ? ' · verificación anti-robot' : ''}`,
      { query: result.query },
    );
    return {
      query: result.query,
      blocked: result.blocked,
      stale: Boolean(result.stale),
      cachedAt: result.cachedAt || null,
      results: result.results.slice(0, 40).sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0)),
    };
  });

  handle('downloads:start', async (_event, { rowKey, updateId, title, jobId } = {}) => {
    if (!rowsByKey(rowKey)[0]) throw new Error('Ese controlador ya no está en la lista.');
    const cached = searchCache.get(rowKey);
    if (!cached || !cached.ids.has(updateId)) {
      throw new Error('Ese paquete no pertenece a la búsqueda de este dispositivo. Vuelve a buscarlo.');
    }
    const urls = await downloads.resolveUrls(updateId);
    const job = String(jobId || `job-${Date.now()}`);
    const controller = new AbortController();
    downloadJobs.set(job, controller);
    send({ type: 'download', jobId: job, phase: 'resolved', message: 'Enlace oficial obtenido.' });
    try {
      const file = await downloads.downloadFile(urls[0], {
        label: title || rowKey,
        jobId: job,
        signal: controller.signal,
        onProgress: (progress) => send({ type: 'download', jobId: job, phase: 'downloading', ...progress }),
      });
      logger.info('download', `Descargado ${title || updateId} (${file.sizeBytes} bytes)`, { path: file.path });
      send({ type: 'download', jobId: job, phase: 'downloaded', ...file });
      return { ...file, jobId: job };
    } catch (error) {
      logger.error('download', `Fallo al descargar ${title || updateId}: ${error.message}`);
      throw error;
    } finally {
      downloadJobs.delete(job);
    }
  });

  handle('downloads:cancel', async (_event, { jobId } = {}) => {
    const controller = downloadJobs.get(String(jobId || ''));
    if (!controller) return { cancelled: false };
    controller.abort();
    return { cancelled: true };
  });

  handle('downloads:extract', async (_event, { cabPath } = {}) => {
    const resolved = path.resolve(String(cabPath || ''));
    if (!isInside(paths.downloadsDir(), resolved)) throw new Error('Solo se extraen paquetes descargados por la aplicación.');
    if (!fs.existsSync(resolved)) throw new Error('El paquete ya no está en la carpeta de descargas.');
    const result = await downloads.expandCab(resolved);
    if (!isInside(paths.downloadsDir(), result.dir)) throw new Error('La extracción apuntó fuera de la carpeta de descargas.');
    installer.approve(result.dir);
    logger.info('download', `Paquete extraído: ${result.infs.length} .inf`, { dir: result.dir });
    return { dir: result.dir, infs: result.infs.length, firstInf: result.infs[0] || null };
  });

  handle('downloads:openFolder', async () => {
    await installer.openFolder(paths.downloadsDir());
    return { path: paths.downloadsDir() };
  });

  handle('logs:tail', async (_event, { limit = 200, level = 'all' } = {}) => ({
    entries: logger.tail(Number(limit) || 200, String(level || 'all')),
    counts: logger.counts(),
    path: logger.logsDir(),
  }));

  handle('logs:clear', async () => {
    logger.clear();
    logger.info('app', 'Registro vaciado por el usuario');
    return { entries: [], counts: logger.counts() };
  });

  handle('logs:openFolder', async () => {
    await installer.openFolder(logger.logsDir());
    return { path: logger.logsDir() };
  });

  handle('logs:export', async (_event, { format = 'txt' } = {}) => {
    const { dialog } = require('electron');
    const entries = logger.tail(5000, 'all');
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const ext = format === 'json' ? 'json' : 'txt';
    const result = await dialog.showSaveDialog(getWindow(), {
      title: 'Guardar registro',
      defaultPath: path.join(paths.reportsDir(), `Registro-DriversUpdatePro-${stamp}.${ext}`),
      filters: [{ name: format === 'json' ? 'JSON' : 'Texto', extensions: [ext] }],
    });
    if (result.canceled || !result.filePath) return null;
    const payload =
      format === 'json'
        ? JSON.stringify({ generatedAt: new Date().toISOString(), counts: logger.counts(), entries }, null, 2)
        : report.buildLogReport({ entries, counts: logger.counts(), system: session.system, stats: session.stats });
    fs.writeFileSync(result.filePath, payload, 'utf8');
    logger.info('app', 'Registro exportado', { path: result.filePath });
    return { path: result.filePath };
  });

  handle('catalog:openFolder', async () => {
    await installer.openFolder(paths.dataRoot());
    return { path: paths.dataRoot() };
  });

  handle('data:openFolder', async () => {
    await installer.openFolder(paths.reportsDir());
    return { path: paths.reportsDir() };
  });

  handle('app:windowsUpdate', async () => {
    await openUrl('ms-settings:windowsupdate');
    return true;
  });

  handle('window:controls', async (_event, action) => {
    const win = getWindow();
    if (!win) return false;
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize') {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    } else if (action === 'close') win.close();
    else throw new Error('Acción de ventana desconocida.');
    return { maximized: win.isMaximized() };
  });

  ipcMain.handle('dialog:about', async () => {
    const win = getWindow();
    await dialog.showMessageBox(win, {
      type: 'info',
      title: 'Snap Drivers Pro',
      message: `Snap Drivers Pro ${app.getVersion()}`,
      detail:
        'Actualizador de controladores. Todo se guarda en esta carpeta.\n\n' +
        `Datos: ${paths.dataRoot()}\n\nFuentes: Windows Update, Catálogo de Microsoft Update y las webs oficiales de cada fabricante.`,
      buttons: ['Cerrar'],
    });
    return true;
  });

  return { session };
}

module.exports = { register, session };
