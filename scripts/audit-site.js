const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'docs', 'index.html');

function checkAssets() {
  const html = fs.readFileSync(HTML, 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map((m) => m[1]);
  const missing = [];
  for (const ref of new Set(refs)) {
    if (/^(https?:|data:|mailto:|#)/.test(ref)) continue;
    const file = path.join(ROOT, 'docs', ref);
    if (!fs.existsSync(file)) missing.push(ref);
  }
  return { total: new Set(refs).size, missing };
}

function checkAnchors() {
  const html = fs.readFileSync(HTML, 'utf8');
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const anchors = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  return anchors.filter((a) => !ids.has(a));
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const assets = checkAssets();
  const badAnchors = checkAnchors();
  console.log('ASSETS', assets.total, 'missing:', assets.missing.length ? assets.missing : 'none');
  console.log('ANCHORS bad:', badAnchors.length ? badAnchors : 'none');

  const win = new BrowserWindow({ width: 1440, height: 900, show: false, backgroundColor: '#070a0f' });
  await win.loadFile(HTML);
  await wait(900);

  for (const [label, width, height] of [['desktop', 1440, 900], ['tablet', 820, 1000], ['mobile', 390, 844]]) {
    await win.setContentSize(width, height);
    await wait(500);
    const info = await win.webContents.executeJavaScript(`
      (() => {
        const doc = document.documentElement;
        const overflowing = [...document.querySelectorAll('body *')]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1);
          })
          .slice(0, 6)
          .map((el) => el.tagName.toLowerCase() + '.' + (el.className || '').toString().split(' ')[0]);
        return {
          scrollWidth: doc.scrollWidth,
          innerWidth: window.innerWidth,
          horizontalScroll: doc.scrollWidth > window.innerWidth + 1,
          overflowing,
          h1: getComputedStyle(document.querySelector('h1')).fontSize,
        };
      })()
    `, true);
    console.log(label, JSON.stringify(info));
  }

  // Accesibilidad básica: contraste de textos secundarios sobre el fondo.
  const contrast = await win.webContents.executeJavaScript(`
    (() => {
      const parse = (c) => (c.match(/\\d+(\\.\\d+)?/g) || []).slice(0, 3).map(Number);
      const lum = ([r, g, b]) => {
        const f = (v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const ratio = (a, b) => {
        const l1 = lum(a), l2 = lum(b);
        return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      };
      const bg = parse(getComputedStyle(document.body).backgroundColor);
      const samples = {};
      for (const sel of ['.hero__lead', '.feature p', '.card__foot', '.footer__legal', '.logos__more']) {
        const el = document.querySelector(sel);
        if (!el) continue;
        samples[sel] = Number(ratio(parse(getComputedStyle(el).color), bg).toFixed(2));
      }
      return samples;
    })()
  `, true);
  console.log('CONTRAST', JSON.stringify(contrast));

  app.exit(0);
});
