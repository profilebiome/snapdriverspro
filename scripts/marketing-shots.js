/**
 * Marketing screenshots (development only).
 *
 * Renders the app with an emulated 1600x1000 viewport at 2x and captures the
 * states the website needs. Run with:
 *
 *   DUP_SCREENSHOT_DIR=<temp> DUP_SHOT_NO_AUTO=1 electron scripts/marketing-shots.js
 *
 * The output goes to docs/shots/.
 */

const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const OUT = path.join(__dirname, '..', 'docs', 'shots');
const WIDTH = 1600;
const HEIGHT = 1000;
const SCALE = 2;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const win = new BrowserWindow({
    width: 1366,
    height: 768,
    show: false,
    frame: false,
    backgroundColor: '#0a0e14',
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), { search: '?screenshot=1' });
  await wait(1200);

  const dbg = win.webContents.debugger;
  dbg.attach('1.3');
  await dbg.sendCommand('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: SCALE,
    mobile: false,
  });
  await wait(600);

  const shot = async (name) => {
    await wait(320);
    const { data } = await dbg.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'));
    console.log('[shot]', name);
  };

  const js = (code) => win.webContents.executeJavaScript(code, true);

  // A clean start requires no stored scan.
  try {
    fs.rmSync(path.join(app.getPath('userData'), 'ultimo-escaneo.json'), { force: true });
  } catch {}
  await win.webContents.reload();
  await wait(1400);

  await shot('start.png');

  await js("document.querySelector('#emptyScanBtn')?.click() || document.querySelector('#scanBtn').click()");
  await wait(1200);
  await shot('scanning.png');

  for (let i = 0; i < 90; i += 1) {
    const done = await js("document.querySelector('#progress').hidden === true");
    if (done) break;
    await wait(1000);
  }
  await wait(700);
  await shot('results.png');

  await js("document.querySelector('#rows .row')?.click()");
  await wait(700);
  await shot('detail.png');
  await js("document.querySelector('#drawerClose').click()");
  await wait(400);

  await js("document.querySelector('#rows [data-action=\"catalog\"]')?.click()");
  await wait(3200);
  await shot('download.png');
  await js("document.querySelector('#downloadClose').click()");
  await wait(400);

  await js("document.querySelector('#batchBtn').click()");
  await wait(9000);
  await shot('batch.png');
  await js("document.querySelector('#batchClose').click()");
  await wait(400);

  await js("document.querySelector('#hardwareBtn').click()");
  await wait(700);
  await shot('hardware.png');
  await js("document.querySelector('#hardwareDone').click()");
  await wait(400);

  await js("document.querySelector('#logsBtn').click()");
  await wait(900);
  await shot('logs.png');

  app.exit(0);
}

app.whenReady().then(() =>
  main().catch((error) => {
    console.error('[shot] error', error);
    app.exit(1);
  }),
);
