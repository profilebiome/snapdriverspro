'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyPnputil } = require('../src/main/pnputil');

test('0 is a clean success', () => {
  assert.deepEqual(classifyPnputil(0), { status: 'ok', ok: true, rebootRequired: false, reason: '' });
});

test('3010 and 1641 are successes that ask for a reboot', () => {
  for (const code of [3010, 1641]) {
    const result = classifyPnputil(code);
    assert.equal(result.ok, true);
    assert.equal(result.status, 'reboot');
    assert.equal(result.rebootRequired, true);
  }
});

test('259 means the package reached the store but no device claimed it', () => {
  const result = classifyPnputil(259);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'no-device');
  assert.match(result.reason, /almacén/);
});

test('access denied and unknown codes stay hard errors', () => {
  assert.equal(classifyPnputil(5).ok, false);
  assert.equal(classifyPnputil(87).status, 'error');
  assert.match(classifyPnputil(87).reason, /87/);
});
