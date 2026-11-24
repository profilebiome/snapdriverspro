'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, Menu, nativeTheme, shell } = require('electron');
const ipc = require('./ipc');
const paths = require('./paths');

const os = require('node:os');

app.setName('Snap Drivers Pro');

const SHOT_DIR = process.env.DUP_SCREENSHOT_DIR || null;
// The screenshot harness is a development tool: never active in a packaged build.
const isScreenshotMode = Boolean(SHOT_DIR) && !app.isPackaged;

// Screenshot runs get their own profile so they never collide with the copy the
// user has open (which owns the single-instance lock and the profile cache).
if (isScreenshotMode) {
  try {
    app.setPath('userData', path.join(os.tmpdir(), 'drivers-update-pro-shots'));
  } catch {
    /* se queda el perfil por defecto */
  }
}

let mainWindow = null;

if (!isScreenshotMode && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

function createWindow() {
  nativeTheme.themeSource = 'dark';

  mainWindow = new BrowserWindow({
    width: isScreenshotMode ? 1600 : 1280,
    height: isScreenshotMode ? 1000 : 820,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    frame: false,
    backgroundColor: '#0a0e14',
    title: 'Snap Drivers Pro',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
      devTools: !app.isPackaged,
    },
  });

  mainWindow.once('ready-to-show', () => {
    if (!isScreenshotMode) mainWindow.show();
  });

  const query = isScreenshotMode ? '?screenshot=1' : '';
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { search: query });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });

  if (!app.isPackaged) {
    mainWindow.webContents.on('console-message', (event) => {
      console.log(`[renderer:${event.level}] ${event.message} (${event.sourceId || ''}:${event.lineNumber || 0})`);
    });
    mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
      console.error('[preload]', preloadPath, error);
    });
  }

  mainWindow.on('maximize', () => mainWindow.webContents.send('window:state', { maximized: true }));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:state', { maximized: false }));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (isScreenshotMode) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => runScreenshots(mainWindow).catch((error) => {
        console.error('[screenshot]', error);
        app.exit(1);
      }), 900);
    });
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function settle(win) {
  await wait(220);
  // make sure Chromium actually produced the frame we are about to capture
  await win.webContents
    .executeJavaScript('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))', true)
    .catch(() => {});
  await wait(80);
}

async function capture(win, name) {
  await settle(win);
  const image = await win.webContents.capturePage();
  const file = path.join(SHOT_DIR, name);
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  fs.writeFileSync(file, image.toPNG());
  console.log(`[screenshot] ${file}`);
}

async function runScreenshots(win) {
  win.show();
  win.focus();
  await wait(700);
  await capture(win, '01-inicio.png');

  await win.webContents.executeJavaScript('window.__dupShots.startScan()', true);
  await wait(900);
  await capture(win, '02-escaneando.png');

  await win.webContents.executeJavaScript('window.__dupShots.waitForScan()', true);
  await wait(700);
  await capture(win, '03-resultados.png');

  await win.webContents.executeJavaScript('window.__dupShots.openFirstRow()', true);
  await wait(600);
  await capture(win, '04-detalle.png');

  await win.webContents.executeJavaScript('window.__dupShots.openSettings()', true);
  await wait(500);
  await capture(win, '05-ajustes.png');

  await win.webContents.executeJavaScript('window.__dupShots.filterUpdates()', true);
  await wait(500);
  await capture(win, '06-filtro-actualizaciones.png');

  await win.webContents.executeJavaScript('window.__dupShots.openFirstRow()', true);
  await wait(420);
  await win.webContents.executeJavaScript('window.__dupShots.scrollDrawer()', true);
  await wait(420);
  await capture(win, '09-rutas-oficiales.png');
  await win.webContents.executeJavaScript('window.__dupShots.closeDrawer()', true);
  await wait(320);

  await win.webContents.executeJavaScript('window.__dupShots.openDownload()', true);
  await wait(3200);
  await capture(win, '10-descarga.png');
  await win.webContents.executeJavaScript("document.querySelector('#downloadPrimary').click()", true);
  await wait(4000);
  await capture(win, '11-descarga-lista.png');
  const downloadedPath = await win.webContents.executeJavaScript(
    "(document.querySelector('#downloadBody').textContent.match(/[A-Z]:\\\\[^\\n]+\.cab/)||[''])[0]",
    true,
  );
  if (downloadedPath) console.log('[screenshot] paquete descargado:', downloadedPath);
  await win.webContents.executeJavaScript("document.querySelector('#downloadClose').click()", true);
  await wait(300);

  await win.webContents.executeJavaScript("document.querySelector('#hardwareBtn').click()", true);
  await wait(600);
  await capture(win, '12-componentes.png');
  await win.webContents.executeJavaScript("document.querySelector('#hardwareDone').click()", true);
  await wait(300);

  await win.webContents.executeJavaScript('window.__dupShots.openBatch()', true);
  await wait(15000);
  await capture(win, '13-actualizar-todo.png');
  await win.webContents.executeJavaScript("document.querySelector('#batchClose').click()", true);
  await wait(400);

  await win.webContents.executeJavaScript("document.querySelector('#logsBtn').click()", true);
  await wait(900);
  await capture(win, '14-registro.png');
  await win.webContents.executeJavaScript("document.querySelector('#logsClose').click()", true);
  await wait(300);

  await win.webContents.executeJavaScript('window.__dupShots.openInstall()', true);
  await wait(600);
  await capture(win, '07-instalar.png');

  await win.webContents.executeJavaScript('window.__dupShots.openExportMenu()', true);
  await wait(400);
  await capture(win, '08-informe.png');

  app.exit(0);
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  app.setAppUserModelId('com.profilebiome.snapdriverspro');
  ipc.register({ getWindow: () => mainWindow });
  createWindow();

  const updater = require('./updater');
  updater.init({ getWindow: () => mainWindow });
  if (app.isPackaged) {
    setTimeout(() => updater.check(), 6000);
    setInterval(() => updater.check(), 6 * 60 * 60 * 1000).unref();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
