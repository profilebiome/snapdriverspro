'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const links = require('../src/main/links');

test('vendor id resolution covers PCI and USB ids', () => {
  assert.equal(links.resolveLinks({ hardwareIds: ['pci\\ven_10de&dev_2504'] }).vendor.name, 'NVIDIA');
  assert.equal(links.resolveLinks({ hardwareIds: ['pci\\ven_8086&dev_0152'] }).vendor.name, 'Intel');
  assert.equal(links.resolveLinks({ hardwareIds: ['usb\\vid_0bda&pid_8153'] }).vendor.name, 'Realtek');
  assert.equal(links.resolveLinks({ hardwareIds: ['swd\\printenum\\{x}'] }).vendor, null);
});

test('unknown vendor ids still get a route to the Microsoft catalog', () => {
  const result = links.resolveLinks({ classKey: 'SYSTEM', hardwareIds: ['pci\\ven_abcd&dev_0001'] });
  assert.equal(result.vendor, null);
  assert.ok(result.catalogUrl && result.catalogUrl.startsWith('https://www.catalog.update.microsoft.com/'));
  assert.equal(result.routes.some((route) => route.id === 'catalog'), true);
});

test('chip routes are class aware', () => {
  const audio = links.resolveLinks({ classKey: 'MEDIA', hardwareIds: ['hdaudio\\func_01&ven_10ec&dev_0b00'] });
  assert.match(audio.vendor.url, /cate_id=593/);

  const net = links.resolveLinks({ classKey: 'NET', hardwareIds: ['pci\\ven_10ec&dev_8168'] });
  assert.match(net.vendor.url, /cate_id=584/);

  const wifi = links.resolveLinks({ classKey: 'NET', hardwareIds: ['pci\\ven_8086&dev_24f3'] });
  assert.match(wifi.vendor.url, /wireless/i);

  const gpu = links.resolveLinks({ classKey: 'DISPLAY', hardwareIds: ['pci\\ven_10de&dev_2504'] });
  assert.equal(gpu.group, 'graphics');
  assert.match(gpu.vendor.url, /nvidia\.com/);
});

test('catalog query uses the generic canonical hardware id', () => {
  const driver = {
    hardwareIds: [
      'pci\\ven_8086&dev_0152&subsys_308c17aa&rev_09',
      'pci\\ven_8086&dev_0152&cc_030000',
      'pci\\ven_8086&dev_0152',
    ],
  };
  assert.equal(links.catalogQueryFor(driver), 'PCI\\VEN_8086&DEV_0152');
  const url = links.resolveLinks(driver).catalogUrl;
  assert.match(url, /^https:\/\/www\.catalog\.update\.microsoft\.com\/Search\.aspx\?q=PCI%5CVEN_8086%26DEV_0152$/);
});

test('usb catalog query keeps vid/pid form', () => {
  assert.equal(links.catalogQueryFor({ hardwareIds: ['usb\\vid_8086&pid_1c26'] }), 'USB\\VID_8086&PID_1C26');
});

test('oem detection covers gaming brands and ignores placeholder manufacturers', () => {
  assert.equal(links.oemFor({ manufacturer: 'LENOVO', model: 'ThinkCentre M72e' }).name, 'Lenovo');
  assert.equal(links.oemFor({ manufacturer: 'LENOVO', model: 'Legion 5 Pro 16ACH6H' }).gaming, true);
  assert.equal(links.oemFor({ manufacturer: 'ASUSTeK COMPUTER INC.', model: 'ROG Strix G16' }).name, 'ASUS / ROG');
  assert.equal(links.oemFor({ manufacturer: 'Acer', model: 'Predator Helios 300' }).name, 'Acer / Predator');
  assert.equal(links.oemFor({ manufacturer: 'Micro-Star International Co., Ltd.', model: 'Katana GF76' }).name, 'MSI');
  assert.equal(links.oemFor({ manufacturer: 'Dell Inc.', model: 'Alienware m16' }).name, 'Dell / Alienware');
  assert.equal(links.oemFor({ manufacturer: 'HP', model: 'OMEN by HP Laptop 16' }).name, 'HP');
  assert.equal(links.oemFor({ manufacturer: 'To be filled by O.E.M.', model: 'B450' }), null);
  assert.equal(links.oemFor({ manufacturer: 'System manufacturer', model: 'System Product Name' }), null);
});

test('dell deep-links the service tag, other OEMs use their hub', () => {
  const dell = links.oemFor({ manufacturer: 'Dell Inc.', model: 'XPS 13', serial: 'ABC1234' });
  assert.match(dell.driversUrl, /servicetag\/ABC1234\/drivers$/);
  const lenovo = links.oemFor({ manufacturer: 'LENOVO', model: 'Legion 5', serial: 'PF3XYZ' });
  assert.equal(lenovo.serialUrl, null);
  assert.match(lenovo.url, /pcsupport\.lenovo\.com/);
});

test('oem owns system classes, chip owns graphics and networking', () => {
  const system = { manufacturer: 'LENOVO', model: 'Legion 5 Pro', serial: 'PF3XYZ' };

  const audio = links.resolveLinks({ classKey: 'MEDIA', hardwareIds: ['hdaudio\\func_01&ven_10ec&dev_0b00'] }, system);
  assert.equal(audio.routes[0].id, 'oem');

  const touchpad = links.resolveLinks({ classKey: 'HIDCLASS', hardwareIds: ['hid\\vid_06cb&pid_cd7e'] }, system);
  assert.equal(touchpad.routes[0].id, 'oem');

  const gpu = links.resolveLinks({ classKey: 'DISPLAY', hardwareIds: ['pci\\ven_10de&dev_2504'] }, system);
  assert.equal(gpu.routes[0].id, 'chip');

  const wifi = links.resolveLinks({ classKey: 'NET', hardwareIds: ['pci\\ven_8086&dev_24f3'] }, system);
  assert.equal(wifi.routes[0].id, 'chip');
});

test('routes always end with the official Microsoft sources', () => {
  const result = links.resolveLinks(
    { classKey: 'DISPLAY', hardwareIds: ['pci\\ven_10de&dev_2504'] },
    { manufacturer: 'ASUS', model: 'ROG Strix G16' },
  );
  const ids = result.routes.map((route) => route.id);
  assert.deepEqual(ids.slice(-2).sort(), ['catalog', 'wu']);
  assert.equal(ids.filter((id) => id === 'catalog').length, 1);
});

test('every official URL in the tables passes the allowlist', () => {
  const urls = [];
  for (const vendor of Object.values(links.VENDORS)) {
    urls.push(vendor.url, ...Object.values(vendor.routes || {}));
  }
  for (const oem of links.OEM_PAGES) if (oem.url) urls.push(oem.url);
  for (const url of urls) {
    assert.equal(links.isAllowedUrl(url), true, `debe permitirse: ${url}`);
  }
  assert.equal(links.isAllowedUrl('https://www.dell.com/support/home'), true);
  assert.equal(links.isAllowedUrl('ms-settings:windowsupdate'), true);
  assert.equal(links.isAllowedUrl('http://www.nvidia.com/Download/index.aspx'), false);
  assert.equal(links.isAllowedUrl('https://example.com/driver.exe'), false);
  assert.equal(links.isAllowedUrl('file:///C:/Windows/System32/cmd.exe'), false);
  assert.equal(links.isAllowedUrl('javascript:alert(1)'), false);
  assert.equal(links.isAllowedUrl('not a url'), false);
});

test('vendor table has no malformed ids', () => {
  for (const id of Object.keys(links.VENDORS)) {
    assert.match(id, /^[0-9a-f]{4}$/, `id de fabricante inválido: ${id}`);
  }
});
