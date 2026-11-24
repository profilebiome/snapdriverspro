'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('../src/main/verdict');

const driver = (overrides = {}) => ({
  deviceName: 'Intel(R) HD Graphics',
  classKey: 'DISPLAY',
  provider: 'Intel Corporation',
  driverVersion: '10.18.10.4252',
  driverDate: '2015-07-09T20:00:00.000Z',
  errorCode: 0,
  hardwareIds: ['pci\\ven_8086&dev_0152&subsys_308c17aa&rev_09', 'pci\\ven_8086&dev_0152'],
  ...overrides,
});

test('compareVersions orders dotted numeric versions', () => {
  assert.equal(v.compareVersions('10.0.19041.1', '10.0.19041'), 1);
  assert.equal(v.compareVersions('9.9.9', '10.0.0'), -1);
  assert.equal(v.compareVersions('1.0.0.0', '1.0'), 0);
  assert.equal(v.compareVersions('', '1.0'), 0);
  assert.equal(v.compareVersions('31.0.101.4502', '27.20.100.9030'), 1);
});

test('normalizeDate handles DMTF /Date()/ and ISO strings', () => {
  assert.equal(v.normalizeDate('/Date(1440993600000)/'), '2015-08-31T04:00:00.000Z');
  assert.equal(new Date(v.normalizeDate('2015-07-09T20:00:00')).getTime(), new Date('2015-07-09T20:00:00').getTime());
  assert.equal(v.normalizeDate('no es fecha'), null);
  assert.equal(v.normalizeDate(null), null);
});

test('signature tolerates the syntax differences between WMI, PnP and Windows Update', () => {
  assert.equal(v.signature('PCI\\VEN_8086&DEV_0152&SUBSYS_308C17AA&REV_09'), 'pci|8086|0152');
  assert.equal(v.signature('pci\\ven_8086&dev_0152'), 'pci|8086|0152');
  assert.equal(v.signature('USB\\ROOT_HUB20&VID8086&PID1C26&REV0004'), 'usb|8086|1c26');
  assert.equal(v.signature('usb\\vid_8086&pid_1c26'), 'usb|8086|1c26');
  assert.equal(v.signature('SWD\\PRINTENUM\\{3FF2DBD0}'), null);
});

test('hardwareIdsIntersect matches short Windows Update ids against full device ids', () => {
  const deviceIds = ['USB\\ROOT_HUB20&VID8086&PID1C26&REV0004', 'USB\\ROOT_HUB20'];
  assert.equal(v.hardwareIdsIntersect(deviceIds, ['usb\\vid_8086&pid_1c26']), true);
  assert.equal(v.hardwareIdsIntersect(deviceIds, ['usb\\vid_0bda&pid_8153']), false);
});

test('findMatchingUpdate falls back to the device model when there are no hardware ids', () => {
  const updates = [
    { updateId: 'a', model: 'Intel(R) Management Engine Interface', hardwareIds: ['pci\\ven_8086&dev_1c3a'] },
    { updateId: 'b', model: 'Realtek High Definition Audio', hardwareIds: [] },
  ];
  assert.equal(v.findMatchingUpdate(driver(), updates), null);
  const noHw = driver({ deviceName: 'Realtek High Definition Audio', hardwareIds: [] });
  assert.equal(v.findMatchingUpdate(noHw, updates).updateId, 'b');
});

test('a driver installed by the app is reported as up to date', () => {
  const result = v.verdictFor(driver({ driverDate: '2018-07-17T00:00:00Z' }), null, null, {
    ageThresholdMonths: 24,
    now: new Date('2026-11-23T00:00:00Z'),
    installedRecord: { at: '2026-11-23T10:00:00Z', label: 'Intel 6 Series', hardwareIds: [] },
  });
  assert.equal(result.level, 'current');
  assert.equal(result.source, 'install');
  assert.match(result.reason, /Instalado por Snap Drivers Pro/);
});

test('a driver verified by the user is reported as up to date', () => {
  const result = v.verdictFor(driver({ driverDate: '2018-07-17T00:00:00Z' }), null, null, {
    ageThresholdMonths: 24,
    now: new Date('2026-11-24T00:00:00Z'),
    verifiedRecord: { at: '2026-11-24T09:00:00Z', version: '10.1.1.44' },
  });
  assert.equal(result.level, 'current');
  assert.equal(result.source, 'verified');
  assert.match(result.reason, /Verificado por ti/);
});

test('a Windows Update match wins over catalog and age', () => {
  const result = v.verdictFor(driver(), { updateId: 'x', provider: 'Intel', model: 'Intel(R) HD Graphics', driverDate: '2024-01-01T00:00:00Z' }, { latestVersion: '99.0.0.0' }, {
    ageThresholdMonths: 24,
  });
  assert.equal(result.level, 'update');
  assert.equal(result.source, 'windows-update');
  assert.match(result.reason, /Windows Update/);
});

test('catalog version decides between update and current', () => {
  const older = v.verdictFor(driver(), null, { latestVersion: '31.0.101.4502' });
  assert.equal(older.level, 'update');
  assert.equal(older.source, 'catalog');
  assert.equal(older.latestVersion, '31.0.101.4502');

  const newer = v.verdictFor(driver({ driverVersion: '31.0.101.4502' }), null, { latestVersion: '31.0.101.4502' });
  assert.equal(newer.level, 'current');
  assert.equal(newer.source, 'catalog');
});

test('Microsoft inbox drivers are never flagged by age', () => {
  const result = v.verdictFor(driver({ provider: 'Microsoft', driverDate: '2006-06-21T00:00:00Z' }), null, null);
  assert.equal(result.level, 'current');
  assert.match(result.reason, /incluido en Windows/);
});

test('old third-party drivers without reference are up to date, with a clear reason', () => {
  const result = v.verdictFor(driver(), null, null, {
    ageThresholdMonths: 24,
    now: new Date('2026-01-01T00:00:00Z'),
  });
  assert.equal(result.level, 'current');
  assert.equal(result.source, 'age');
  assert.match(result.reason, /no ofrece nada más nuevo|no hay una versión de referencia/);
});

test('a catalog package reference decides between update and current', () => {
  const older = v.verdictFor(driver({ driverVersion: '10.0.0.1' }), null, null, {
    catalogReference: { version: '11.0.0.1', date: '2024-05-01' },
  });
  assert.equal(older.level, 'update');
  assert.equal(older.source, 'catalog-package');
  assert.match(older.reason, /11.0.0.1/);

  const same = v.verdictFor(driver({ driverVersion: '11.0.0.1' }), null, null, {
    catalogReference: { version: '11.0.0.1', date: '2024-05-01' },
  });
  assert.equal(same.level, 'current');
  assert.equal(same.source, 'catalog-package');
});

test('recent drivers with no reference stay unknown instead of claiming they are current', () => {
  const result = v.verdictFor(driver({ driverDate: '2025-12-01T00:00:00Z' }), null, null, {
    ageThresholdMonths: 24,
    now: new Date('2026-01-01T00:00:00Z'),
  });
  assert.equal(result.level, 'unknown');
  assert.match(result.reason, /sin versión de referencia/i);
});

test('driver error codes surface as error when nothing newer exists', () => {
  const result = v.verdictFor(driver({ errorCode: 28 }), null, null);
  assert.equal(result.level, 'error');
  assert.match(result.reason, /28/);
});

test('a loose model-name containment no longer hijacks an unrelated update', () => {
  const updates = [{ updateId: 'r', model: 'Realtek High Definition Audio', hardwareIds: ['hdaudio\func_01&ven_10ec&dev_0892'] }];
  const device = { deviceName: 'Audio', hardwareIds: ['hdaudio\func_01&ven_10ec&dev_0b00'] };
  assert.equal(v.findMatchingUpdate(device, updates), null);
});

test('a non-numeric catalog version never reports “current”', () => {
  const result = v.verdictFor(driver({ driverVersion: '' }), null, { latestVersion: '31.0.101.4502' });
  assert.equal(result.level, 'unknown');
  assert.equal(result.source, 'catalog');
  assert.match(result.reason, /no es numérica/);
});

test('a device with a problem code is never reported as up to date', () => {
  const result = v.verdictFor(driver({ errorCode: 43, driverVersion: '31.0.101.4502' }), null, {
    latestVersion: '31.0.101.4502',
  });
  assert.equal(result.level, 'error');
  assert.match(result.reason, /43/);
});

test('matchCatalogEntry respects class, vendor and pattern', () => {
  const entries = [
    { id: 'nvidia', deviceClass: 'DISPLAY', vendor: 'NVIDIA', matchPattern: 'geforce|rtx' },
    { id: 'intel', deviceClass: 'DISPLAY', vendor: 'Intel', matchPattern: 'intel.*graphics' },
    { id: 'net', deviceClass: 'NET', vendor: 'Intel', matchPattern: 'wireless' },
  ];
  assert.equal(v.matchCatalogEntry(driver(), entries).id, 'intel');
  assert.equal(v.matchCatalogEntry(driver({ classKey: 'NET' }), entries), null);
  assert.equal(v.matchCatalogEntry(driver({ deviceName: 'NVIDIA GeForce RTX 3060', provider: 'NVIDIA' }), entries).id, 'nvidia');
});

test('an invalid catalog regex is ignored instead of throwing', () => {
  const entries = [{ id: 'roto', deviceClass: 'DISPLAY', vendor: 'Intel', matchPattern: '([unclosed' }];
  assert.equal(v.matchCatalogEntry(driver(), entries), null);
  entries.push({ id: 'valido', deviceClass: 'DISPLAY', vendor: 'Intel', matchPattern: 'graphics' });
  assert.equal(v.matchCatalogEntry(driver(), entries).id, 'valido');
});

test('levelRank keeps the actionable levels first', () => {
  assert.ok(v.levelRank('update') < v.levelRank('error'));
  assert.ok(v.levelRank('error') < v.levelRank('review'));
  assert.ok(v.levelRank('review') < v.levelRank('current'));
});
