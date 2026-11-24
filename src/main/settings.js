'use strict';

const fs = require('node:fs');
const paths = require('./paths');

const DEFAULTS = {
  ageThresholdMonths: 24,
  showSoftwareDevices: false,
  createRestorePoint: true,
  lastScanAt: null,
  windowBounds: null,
};

function clampThreshold(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULTS.ageThresholdMonths;
  return Math.min(120, Math.max(6, Math.round(number)));
}

function load() {
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(paths.settingsFile(), 'utf8').replace(/^\uFEFF/, '')) || {};
  } catch {
    stored = {};
  }
  return {
    ...DEFAULTS,
    ...stored,
    ageThresholdMonths: clampThreshold(stored.ageThresholdMonths),
    showSoftwareDevices: Boolean(stored.showSoftwareDevices),
    createRestorePoint: stored.createRestorePoint !== false,
  };
}

function save(patch = {}) {
  const next = { ...load(), ...patch };
  next.ageThresholdMonths = clampThreshold(next.ageThresholdMonths);
  next.showSoftwareDevices = Boolean(next.showSoftwareDevices);
  next.createRestorePoint = next.createRestorePoint !== false;
  fs.writeFileSync(paths.settingsFile(), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

module.exports = { DEFAULTS, load, save };
