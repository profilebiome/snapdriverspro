'use strict';

/**
 * Activity log: one JSON line per event, kept next to the portable data.
 * It is the only place where the app records what happened, and the source for
 * the "Registro" view and the exported diagnostic report.
 */

const fs = require('node:fs');
const path = require('node:path');
const paths = require('./paths');

const MAX_BYTES = 2 * 1024 * 1024;
const KEEP = 500;

function logsDir() {
  const dir = path.join(paths.dataRoot(), 'Registros');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function logFile() {
  return path.join(logsDir(), 'actividad.jsonl');
}

function rotate() {
  try {
    const file = logFile();
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) {
      fs.renameSync(file, path.join(logsDir(), `actividad-${Date.now()}.jsonl`));
    }
  } catch {
    /* la rotación es best-effort */
  }
}

/**
 * @param {'info'|'warn'|'error'} level
 * @param {string} area  scan | windows-update | catalog | download | install | settings | app
 * @param {string} message
 * @param {object} [data]
 */
function log(level, area, message, data = undefined) {
  const entry = {
    at: new Date().toISOString(),
    level,
    area,
    message: String(message).slice(0, 2000),
  };
  if (data !== undefined) {
    try {
      entry.data = JSON.parse(JSON.stringify(data));
    } catch {
      entry.data = null;
    }
  }
  try {
    rotate();
    fs.appendFileSync(logFile(), `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    /* si no se puede escribir, la app sigue funcionando */
  }
  return entry;
}

const info = (area, message, data) => log('info', area, message, data);
const warn = (area, message, data) => log('warn', area, message, data);
const error = (area, message, data) => log('error', area, message, data);

function readAll() {
  try {
    return fs
      .readFileSync(logFile(), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { at: '', level: 'warn', area: 'app', message: line.slice(0, 500) };
        }
      });
  } catch {
    return [];
  }
}

function tail(limit = 200, level = 'all') {
  const entries = readAll();
  const filtered = level === 'all' ? entries : entries.filter((entry) => entry.level === level);
  return filtered.slice(-Math.max(1, Math.min(limit, KEEP)));
}

function counts() {
  const entries = readAll();
  return {
    total: entries.length,
    info: entries.filter((entry) => entry.level === 'info').length,
    warn: entries.filter((entry) => entry.level === 'warn').length,
    error: entries.filter((entry) => entry.level === 'error').length,
  };
}

function clear() {
  try {
    fs.writeFileSync(logFile(), '', 'utf8');
  } catch {
    /* nada que limpiar */
  }
}

module.exports = { log, info, warn, error, tail, counts, clear, logsDir, logFile, readAll };
