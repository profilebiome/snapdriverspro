'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PS = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

/** Children currently running, so a cancelled scan can actually stop them. */
const activeChildren = new Set();

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function killAll() {
  for (const child of activeChildren) {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  }
  activeChildren.clear();
}

/**
 * Runs a PowerShell script file with `-NoProfile` and returns its raw stdout.
 * Arguments are passed as an array (no shell involved).
 */
function runScript(scriptPath, args = [], { timeoutMs = 180_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      PS,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args.map(String)],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    activeChildren.add(child);

    const out = [];
    const err = [];
    let settled = false;
    let timer = null;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      activeChildren.delete(child);
      fn(value);
    };

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* already gone */
        }
        finish(reject, new Error(`La consulta tardó más de ${Math.round(timeoutMs / 1000)} s y se canceló.`));
      }, timeoutMs);
    }

    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.on('error', (error) => finish(reject, error));
    child.on('close', (code) => {
      const stdout = Buffer.concat(out).toString('utf8').trim();
      const stderr = Buffer.concat(err).toString('utf8').trim();
      if (code !== 0 && !stdout) {
        finish(reject, new Error(stderr || `PowerShell terminó con código ${code}.`));
        return;
      }
      finish(resolve, { code, stdout, stderr });
    });
  });
}

/**
 * Runs a script elevated through UAC. The elevated process writes its JSON result
 * to a temp file, which this function reads and returns.
 *
 * The inner argument line is a PowerShell *single-quoted* literal: paths chosen by
 * the user (download folders can contain `$`, backticks or `$(...)`) must reach the
 * child verbatim instead of being expanded by the unelevated parent shell.
 */
async function runElevatedScript(scriptPath, args = [], { timeoutMs = 300_000 } = {}) {
  const outFile = path.join(os.tmpdir(), `dup-elevated-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  const allArgs = [...args, outFile];

  const argLine = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `"${scriptPath}"`, ...allArgs.map((a) => `"${a}"`)].join(
    ' ',
  );

  const command = [
    'Start-Process',
    '-FilePath',
    psQuote(PS),
    '-Verb',
    'RunAs',
    '-Wait',
    '-WindowStyle',
    'Hidden',
    '-ArgumentList',
    psQuote(argLine),
  ].join(' ');

  try {
    await new Promise((resolve, reject) => {
      const child = spawn(PS, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      activeChildren.add(child);
      const err = [];
      let settled = false;
      const done = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        activeChildren.delete(child);
        fn(value);
      };
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* ignore */
        }
        done(reject, new Error('La operación elevada no respondió a tiempo.'));
      }, timeoutMs);

      child.stderr.on('data', (chunk) => err.push(chunk));
      child.on('error', (error) => done(reject, error));
      child.on('close', (code) => {
        if (code === 0) done(resolve);
        else done(reject, new Error(Buffer.concat(err).toString('utf8').trim() || 'El permiso de administrador fue cancelado.'));
      });
    });

    if (!fs.existsSync(outFile)) throw new Error('La operación elevada no devolvió ningún resultado.');
    return JSON.parse(fs.readFileSync(outFile, 'utf8').replace(/^\uFEFF/, ''));
  } finally {
    try {
      fs.unlinkSync(outFile);
    } catch {
      /* nothing to clean */
    }
  }
}

module.exports = { runScript, runElevatedScript, killAll, PS };
