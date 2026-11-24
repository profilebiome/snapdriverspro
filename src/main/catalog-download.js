'use strict';

/**
 * Official package download through the Microsoft Update Catalog.
 *
 * The catalog has no documented API: this module performs exactly the two HTTP
 * requests the public web page performs when a person searches a hardware ID and
 * clicks "Download" (Search.aspx then DownloadDialog.aspx). It downloads only the
 * URL Microsoft returns, from Microsoft hosts, one package per explicit user
 * action — no crawling, no mirroring, no third-party binaries.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const https = require('node:https');
const { URL } = require('node:url');

const SEARCH_URL = 'https://www.catalog.update.microsoft.com/Search.aspx?q=';
const DIALOG_URL = 'https://www.catalog.update.microsoft.com/DownloadDialog.aspx';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 DriversUpdatePro/1.2';
const MAX_BYTES = 900 * 1024 * 1024;
const MAX_HTML_BYTES = 8 * 1024 * 1024;
const MAX_EXTRACT_BYTES = 2 * 1024 * 1024 * 1024;
const CATALOG_HOSTS = new Set(['www.catalog.update.microsoft.com', 'catalog.update.microsoft.com']);

const DOWNLOAD_HOSTS = new Set(['catalog.s.download.windowsupdate.com', 'download.windowsupdate.com', 'catalog.s.download.microsoft.com']);

function isDownloadUrl(raw) {
  try {
    const url = new URL(String(raw));
    return url.protocol === 'https:' && DOWNLOAD_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function request(url, { method = 'GET', form = null, timeoutMs = 30_000 } = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (target.protocol !== 'https:' || !CATALOG_HOSTS.has(target.hostname)) {
      reject(new Error('El catálogo redirigió a un host no permitido.'));
      return;
    }
    const body = form ? Buffer.from(form, 'utf8') : null;
    const req = https.request(
      {
        hostname: target.hostname,
        path: `${target.pathname}${target.search}`,
        method,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
          Connection: 'close',
          ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': body.length } : {}),
        },
        timeout: timeoutMs,
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          if (redirects >= 5) {
            reject(new Error('Demasiadas redirecciones al consultar el catálogo.'));
            return;
          }
          let next;
          try {
            next = new URL(res.headers.location, target);
          } catch {
            reject(new Error('Redirección inválida del catálogo.'));
            return;
          }
          if (next.protocol !== 'https:' || !CATALOG_HOSTS.has(next.hostname)) {
            reject(new Error('El catálogo redirigió a un host no permitido.'));
            return;
          }
          request(next.toString(), { method: 'GET', timeoutMs }, redirects + 1).then(resolve, reject);
          return;
        }
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_HTML_BYTES) {
            res.destroy();
            reject(new Error('La respuesta del catálogo es demasiado grande.'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('El catálogo de Microsoft no respondió a tiempo.')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function stripTags(html) {
  return String(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parseResults(html) {
  const results = [];
  const rowRe = /<tr id="([0-9a-fA-F-]{36})_R0"[\s\S]*?<\/tr>/g;
  let match;
  while ((match = rowRe.exec(html)) !== null) {
    const block = match[0];
    const id = match[1];
    const titleMatch = block.match(/id='[0-9a-fA-F-]{36}_link'[^>]*>([\s\S]*?)<\/a>/);
    if (!titleMatch) continue;
    const cell = (n) => {
      const found = block.match(new RegExp(`_C${n}_R0"[^>]*>([\\s\\S]*?)</td>`));
      return found ? stripTags(found[1]) : '';
    };
    const size = block.match(/_originalSize">(\d+)</);
    results.push({
      updateId: id,
      title: stripTags(titleMatch[1]),
      products: cell(2),
      classification: cell(3),
      lastUpdated: cell(4),
      version: cell(5) === 'n/a' ? '' : cell(5),
      sizeBytes: size ? Number(size[1]) : Number.parseFloat(cell(6)) * 1024 * 1024 || 0,
    });
  }
  return results;
}

function parseFallback(html) {
  // Survives table/row markup changes: any anchor whose id carries an update GUID.
  const byAnchor = [...html.matchAll(/<a[^>]*id=['"]([0-9a-fA-F-]{36})_link['"][^>]*>([\s\S]*?)<\/a>/g)];
  if (byAnchor.length > 0) {
    return byAnchor.map((match) => ({
      updateId: match[1],
      title: stripTags(match[2]) || 'Paquete de controlador',
      products: '',
      classification: '',
      lastUpdated: '',
      version: '',
      sizeBytes: 0,
    }));
  }
  // Last resort: the update id appears in a goToDetails call; take the text before it.
  const byCall = [...html.matchAll(/goToDetails\(['"]([0-9a-fA-F-]{36})['"]\)/g)];
  const seen = new Set();
  const results = [];
  for (const match of byCall) {
    if (seen.has(match[1])) continue;
    seen.add(match[1]);
    const before = html.slice(Math.max(0, (match.index || 0) - 400), match.index || 0);
    const anchorText = before.match(/>([^<>]{8,240})<\s*$/);
    results.push({
      updateId: match[1],
      title: anchorText ? stripTags(anchorText[1]) : 'Paquete de controlador',
      products: '',
      classification: '',
      lastUpdated: '',
      version: '',
      sizeBytes: 0,
    });
  }
  return results;
}

function normalizeQuery(hardwareId) {
  const cleaned = String(hardwareId || '')
    .replace(/[^A-Za-z0-9\\&_.{}#;:\-]/g, '')
    .trim();
  if (!cleaned) throw new Error('Hardware ID vacío.');
  return cleaned;
}

async function searchOnce(query) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await request(`${SEARCH_URL}${encodeURIComponent(query)}`);
      if (response.status !== 200) throw new Error(`El catálogo respondió con HTTP ${response.status}.`);
      const primary = parseResults(response.body);
      const blocked = /captcha|robot/i.test(response.body) && primary.length === 0;
      const results = primary.length > 0 ? primary : parseFallback(response.body);
      return { query, results, blocked };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
    }
  }
  throw lastError || new Error('El catálogo de Microsoft no respondió.');
}

const searchCache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function cacheFile() {
  const paths = require('./paths');
  return path.join(paths.dataRoot(), 'catalog-cache.json');
}

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(), 'utf8'));
  } catch {
    return {};
  }
}

function writeCache(data) {
  try {
    fs.writeFileSync(cacheFile(), JSON.stringify(data), 'utf8');
  } catch {
    /* la caché es una mejora, no un requisito */
  }
}

/**
 * Searches the catalog for one or more hardware ID variants. Falls back to the
 * second parser, retries transient failures and, if Microsoft is unreachable,
 * returns the last successful answer (marked stale) instead of failing hard.
 */
async function search(hardwareIds, extraQueries = []) {
  const variants = [
    ...new Set(
      [...[].concat(hardwareIds || []), ...(extraQueries || [])]
        .map((id) => normalizeQuery(id))
        .filter(Boolean),
    ),
  ].slice(0, 4);
  if (variants.length === 0) throw new Error('Hardware ID vacío.');

  let lastError = null;
  for (const query of variants) {
    try {
      const result = await searchOnce(query);
      if (result.results.length > 0) {
        const cache = readCache();
        cache[query] = { at: Date.now(), results: result.results };
        writeCache(cache);
        return result;
      }
      lastError = null;
    } catch (error) {
      lastError = error;
    }
  }

  const cache = readCache();
  for (const query of variants) {
    const entry = cache[query];
    if (entry && Array.isArray(entry.results) && entry.results.length > 0 && Date.now() - entry.at < CACHE_TTL_MS) {
      return { query, results: entry.results, blocked: false, stale: true, cachedAt: entry.at };
    }
  }

  if (lastError) throw lastError;
  return { query: variants[0], results: [], blocked: false };
}

async function resolveUrls(updateId) {
  const id = String(updateId || '');
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) throw new Error('Identificador de actualización inválido.');
  const payload = JSON.stringify([{ size: 0, updateID: id, uidInfo: id }]);
  const form = new URLSearchParams({
    updateIDs: payload,
    updateIDsBlockedForImport: '',
    wsusApiPresent: '',
    contentImport: '',
    sku: '',
    serverName: '',
    s: '',
  }).toString();
  const response = await request(DIALOG_URL, { method: 'POST', form });
  const urls = [...response.body.matchAll(/url\s*=\s*'([^']+)'/g)].map((m) => m[1]);
  const allowed = urls.filter(isDownloadUrl);
  if (allowed.length === 0) throw new Error('Microsoft no devolvió ninguna URL de descarga para ese paquete.');
  return allowed;
}

function safeName(value, max = 80) {
  return String(value)
    .replace(/[^\w.\- ]+/g, '')
    .replace(/\s+/g, '-')
    .slice(0, max) || 'paquete';
}

function buildTarget(rawUrl, label, jobId) {
  const url = new URL(rawUrl);
  const base = url.pathname.split('/').pop() || 'paquete.cab';
  const ext = path.extname(base).slice(0, 8);
  const stem = safeName(path.basename(base, path.extname(base)), 60);
  const name = `${safeName(label, 60)}-${stem}${ext}`;
  return path.join(downloadsDir(), name);
}

function downloadsDir() {
  const paths = require('./paths');
  const dir = path.join(paths.dataRoot(), 'Descargas');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Streams one package to disk and reports progress. `signal` aborts the transfer,
 * and each attempt writes its own `.part` file so two downloads never collide.
 */
function downloadFile(
  rawUrl,
  { label = 'paquete', onProgress = () => {}, jobId = '', signal = null } = {},
  redirects = 0,
) {
  if (!isDownloadUrl(rawUrl)) return Promise.reject(new Error('URL de descarga no permitida.'));
  if (signal?.aborted) return Promise.reject(new Error('Descarga cancelada.'));
  const url = new URL(rawUrl);
  const target = buildTarget(rawUrl, label, jobId);
  const partial = `${target}.${safeName(jobId || Date.now(), 40)}.part`;

  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      fn(value);
    };
    const cleanupPartial = () => {
      try {
        fs.rmSync(partial, { force: true });
      } catch {
        /* el archivo puede estar bloqueado por el antivirus */
      }
    };
    const onAbort = () => {
      req.destroy(new Error('Descarga cancelada.'));
      cleanupPartial();
    };

    const req = https.get(
      {
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
        timeout: 60_000,
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          if (redirects >= 5) {
            finish(reject, new Error('Demasiadas redirecciones al descargar el paquete.'));
            return;
          }
          downloadFile(new URL(res.headers.location, url).toString(), { label, onProgress, jobId, signal }, redirects + 1).then(
            (value) => finish(resolve, value),
            (error) => finish(reject, error),
          );
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          finish(reject, new Error(`La descarga devolvió HTTP ${res.statusCode}.`));
          return;
        }
        const total = Number(res.headers['content-length']) || 0;
        if (total > MAX_BYTES) {
          res.destroy();
          finish(reject, new Error('El paquete supera el tamaño máximo admitido (900 MB).'));
          return;
        }
        const out = fs.createWriteStream(partial);
        let received = 0;
        let last = 0;
        res.on('data', (chunk) => {
          received += chunk.length;
          if (received > MAX_BYTES) {
            res.destroy();
            out.destroy();
            cleanupPartial();
            finish(reject, new Error('El paquete supera el tamaño máximo admitido (900 MB).'));
            return;
          }
          const now = Date.now();
          if (now - last > 180) {
            last = now;
            onProgress({ received, total, percent: total ? Math.min(99, Math.round((received / total) * 100)) : null });
          }
        });
        res.on('error', (error) => {
          out.destroy();
          cleanupPartial();
          finish(reject, error);
        });
        res.pipe(out);
        out.on('finish', () => {
          out.close(() => {
            try {
              const header = Buffer.alloc(4);
              const fd = fs.openSync(partial, 'r');
              fs.readSync(fd, header, 0, 4, 0);
              fs.closeSync(fd);
              if (header.toString('ascii') !== 'MSCF') {
                cleanupPartial();
                finish(reject, new Error('El archivo descargado no es un paquete CAB de Microsoft.'));
                return;
              }
              fs.renameSync(partial, target);
              onProgress({ received, total: total || received, percent: 100 });
              finish(resolve, { path: target, sizeBytes: received });
            } catch (error) {
              cleanupPartial();
              finish(reject, error);
            }
          });
        });
        out.on('error', (error) => {
          cleanupPartial();
          finish(reject, error);
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('La descarga se quedó sin respuesta.')));
    req.on('error', (error) => {
      cleanupPartial();
      finish(reject, error);
    });
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

const SYSTEM32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');

function expandCab(cabPath) {
  return new Promise((resolve, reject) => {
    const dest = path.join(path.dirname(cabPath), `${path.parse(cabPath).name}-extraido`);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    // System32's expand, not whatever `expand` a developer PATH may resolve first.
    const child = spawn(path.join(SYSTEM32, 'expand.exe'), ['-F:*', cabPath, dest], { windowsHide: true });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`No se pudo extraer el paquete (código ${code}). ${output.trim().slice(0, 400)}`));
        return;
      }
      const infs = [];
      const walk = (dir, depth = 0) => {
        if (depth > 4) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full, depth + 1);
          else if (entry.name.toLowerCase().endsWith('.inf')) infs.push(full);
        }
      };
      walk(dest);
      let totalBytes = 0;
      const weigh = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) weigh(full);
          else {
            try {
              totalBytes += fs.statSync(full).size;
            } catch {
              /* archivo eliminado por el antivirus */
            }
          }
        }
      };
      weigh(dest);
      if (totalBytes > MAX_EXTRACT_BYTES) {
        try {
          fs.rmSync(dest, { recursive: true, force: true });
        } catch {
          /* se intenta de nuevo en la próxima descarga */
        }
        reject(new Error('El paquete extraído supera los 2 GB y se descartó.'));
        return;
      }
      resolve({ dir: dest, infs, output: output.trim() });
    });
  });
}

function cleanup(filePath) {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    /* el archivo puede estar en uso */
  }
}

module.exports = {
  search,
  resolveUrls,
  downloadFile,
  expandCab,
  downloadsDir,
  isDownloadUrl,
  parseResults,
  parseFallback,
  cleanup,
  MAX_BYTES,
  MAX_EXTRACT_BYTES,
};
