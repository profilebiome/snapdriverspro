'use strict';

/**
 * Runs a PowerShell script with administrator rights and waits for its JSON
 * result file.
 *
 * - Already elevated: the script runs directly (no UAC, no window).
 * - Otherwise: one UAC prompt for a hidden PowerShell that executes the script
 *   and waits. The app stays alive, so a cancelled prompt is reported instead of
 *   leaving the interface loading forever.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SYSTEM32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const PS = path.join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');

let elevatedCache = null;

function isElevated() {
  if (elevatedCache !== null) return Promise.resolve(elevatedCache);
  return new Promise((resolve) => {
    const child = spawn(path.join(SYSTEM32, 'cmd.exe'), ['/c', 'net', 'session'], { windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      elevatedCache = false;
      resolve(false);
    }, 4000);
    child.on('error', () => {
      clearTimeout(timer);
      elevatedCache = false;
      resolve(false);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      elevatedCache = code === 0;
      resolve(elevatedCache);
    });
  });
}

function runProcess(file, args, { timeoutMs = 600_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      finish(reject, new Error(`La instalación tardó más de ${Math.round(timeoutMs / 60000)} minutos y se canceló.`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      out += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      err += chunk.toString();
    });
    child.on('error', (error) => finish(reject, error));
    child.on('close', (code) => finish(resolve, { code, stdout: out, stderr: err }));
  });
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function cmdQuote(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function readResult(outFile) {
  try {
    if (!fs.existsSync(outFile)) throw new Error('La operación no devolvió ningún resultado.');
    const raw = fs.readFileSync(outFile, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw);
  } finally {
    try {
      fs.unlinkSync(outFile);
    } catch {
      /* temporal */
    }
  }
}

/**
 * @param {string} scriptPath
 * @param {string[]} args  script arguments (the result file is appended)
 * @param {{ timeoutMs?: number }} options
 */
async function runElevatedAndWait(scriptPath, args = [], { timeoutMs = 300_000 } = {}) {
  const outFile = path.join(os.tmpdir(), `dup-out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  const allArgs = [...args, outFile];
  const elevated = await isElevated();

  if (elevated) {
    const result = await runProcess(
      PS,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath, ...allArgs],
      { timeoutMs },
    );
    if (result.code !== 0 && !fs.existsSync(outFile)) {
      throw new Error((result.stderr || '').trim() || `PowerShell terminó con código ${result.code}.`);
    }
    return readResult(outFile);
  }

  const inner = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath, ...allArgs]
    .map(cmdQuote)
    .join(' ');
  const command = [
    '$p = Start-Process',
    '-FilePath', psQuote(PS),
    '-Verb', 'RunAs',
    '-WindowStyle', 'Hidden',
    '-Wait',
    '-PassThru',
    '-ArgumentList', psQuote(inner),
    '; exit $p.ExitCode',
  ].join(' ');

  const result = await runProcess(
    PS,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', command],
    { timeoutMs },
  );
  if (result.code !== 0 && !fs.existsSync(outFile)) {
    const message = (result.stderr || '').trim();
    if (/cancel|cancelad|1223|denied|denegad/i.test(message)) throw new Error('Permiso de administrador cancelado.');
    throw new Error(message || 'Windows no permitió la instalación con permisos de administrador.');
  }
  return readResult(outFile);
}

module.exports = { runElevatedAndWait, isElevated };
