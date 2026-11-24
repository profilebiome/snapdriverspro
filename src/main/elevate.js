'use strict';

/**
 * Runs a PowerShell script elevated without ever showing a console window.
 *
 * - If the app is already elevated: the script runs directly (no UAC, no window).
 * - Otherwise elevation goes through `wscript.exe`, which has no console: a tiny
 *   VBS launches a .cmd (also hidden) that runs PowerShell and redirects its
 *   output. The only thing the user sees is the Windows UAC prompt.
 *
 * Keeping the command inside a .cmd file avoids nested-quote escaping in VBS,
 * which is the part that usually breaks these silent-elevation tricks.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SYSTEM32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const PS = path.join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const WSCRIPT = path.join(SYSTEM32, 'wscript.exe');

let elevatedCache = null;

/** True when this process runs with administrator rights (cached). */
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
      finish(reject, new Error('La operación elevada no respondió a tiempo.'));
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

function buildCmdFile(scriptPath, args) {
  const cmd = [
    '@echo off',
    `"${PS}" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "${scriptPath}" ${args
      .map((value) => `"${value}"`)
      .join(' ')}`,
    '',
  ].join('\r\n');
  const file = path.join(os.tmpdir(), `dup-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.cmd`);
  fs.writeFileSync(file, cmd, 'utf8');
  return file;
}

function buildVbsFile(cmdPath) {
  // One quoted argument for `Run`, no nested quoting to get wrong.
  const file = path.join(os.tmpdir(), `dup-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.vbs`);
  const body = ['Set sh = CreateObject("WScript.Shell")', `sh.Run """${cmdPath}""", 0, True`, ''].join('\r\n');
  fs.writeFileSync(file, body, 'utf16le');
  return file;
}

function readResult(outFile) {
  try {
    if (!fs.existsSync(outFile)) throw new Error('La operación elevada no devolvió ningún resultado.');
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

async function runElevatedSilent(scriptPath, args = [], { timeoutMs = 600_000 } = {}) {
  const outFile = path.join(os.tmpdir(), `dup-out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  const allArgs = [...args, outFile];

  if (await isElevated()) {
    await runProcess(
      PS,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath, ...allArgs],
      { timeoutMs },
    );
    return readResult(outFile);
  }

  const cmdFile = buildCmdFile(scriptPath, allArgs);
  const vbsFile = buildVbsFile(cmdFile);
  try {
    const launcher = `Start-Process -FilePath '${WSCRIPT}' -ArgumentList '"${vbsFile}"' -Verb RunAs -WindowStyle Hidden -Wait`;
    const result = await runProcess(
      PS,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', launcher],
      { timeoutMs },
    );
    if (result.code !== 0) {
      const message = (result.stderr || '').trim();
      throw new Error(message || 'El permiso de administrador fue cancelado.');
    }
    return readResult(outFile);
  } finally {
    for (const file of [vbsFile, cmdFile]) {
      try {
        fs.unlinkSync(file);
      } catch {
        /* temporal */
      }
    }
  }
}

module.exports = { runElevatedSilent, isElevated, SYSTEM32, PS, OPERATOR: undefined };
