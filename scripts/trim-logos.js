/**
 * Development tool: crops every logo SVG to its ink bounding box so the logo
 * wall renders all brands at the same optical size. Writes the SVGs in place.
 *
 *   electron scripts/trim-logos.js
 */

const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const DIR = path.join(__dirname, '..', 'docs', 'logos');
const SIZE = 240;

async function trim(win, file) {
  const svg = fs.readFileSync(file, 'utf8');
  const data = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const box = await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = ${SIZE};
        canvas.height = ${SIZE};
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, ${SIZE}, ${SIZE});
        const { data } = ctx.getImageData(0, 0, ${SIZE}, ${SIZE});
        let minX = ${SIZE}, minY = ${SIZE}, maxX = -1, maxY = -1;
        for (let y = 0; y < ${SIZE}; y += 1) {
          for (let x = 0; x < ${SIZE}; x += 1) {
            if (data[(y * ${SIZE} + x) * 4 + 3] > 8) {
              if (x < minX) minX = x;
              if (y < minY) minY = y;
              if (x > maxX) maxX = x;
              if (y > maxY) maxY = y;
            }
          }
        }
        resolve(maxX < 0 ? null : { minX, minY, maxX, maxY, w: ${SIZE}, h: ${SIZE} });
      };
      img.onerror = () => resolve(null);
      img.src = '${data}';
    })
  `, true);
  if (!box) return null;

  const scale = 24 / SIZE;
  const pad = 0.4;
  const x = Math.max(0, (box.minX - 2) * scale);
  const y = Math.max(0, (box.minY - 2) * scale);
  const w = Math.min(24 - x, (box.maxX - box.minX + 4) * scale + pad);
  const h = Math.min(24 - y, (box.maxY - box.minY + 4) * scale + pad);
  const next = svg.replace(/viewBox="[^"]+"/, `viewBox="${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}"`);
  fs.writeFileSync(file, next, 'utf8');
  return { file: path.basename(file), w: Number(w.toFixed(2)), h: Number(h.toFixed(2)) };
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { webSecurity: false } });
  await win.loadURL('data:text/html,<html><body></body></html>');
  const files = fs.readdirSync(DIR).filter((name) => name.endsWith('.svg'));
  for (const name of files) {
    const result = await trim(win, path.join(DIR, name));
    console.log(result ? `${result.file} -> ${result.w} x ${result.h}` : `${name} -> skipped`);
  }
  app.exit(0);
});
