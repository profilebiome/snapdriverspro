'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../src/main/catalog-download');

const FIXTURE = `
<table>
  <tr id="69c7f62f-9bad-4a91-9045-b287b93c4c2f_R0" style="border-width:0px;">
    <td class="x" id="69c7f62f-9bad-4a91-9045-b287b93c4c2f_C0_R0"></td>
    <td class="x" id="69c7f62f-9bad-4a91-9045-b287b93c4c2f_C1_R0">
      <a id='69c7f62f-9bad-4a91-9045-b287b93c4c2f_link' href="javascript:void(0);" onclick='goToDetails("69c7f62f-9bad-4a91-9045-b287b93c4c2f");' class="c">
        Intel Corporation - Display - 12/27/2018 12:00:00 AM - 10.18.10.5069
      </a>
    </td>
    <td class="x" id="69c7f62f-9bad-4a91-9045-b287b93c4c2f_C2_R0">Windows 10, Windows 11 &amp; later</td>
    <td class="x" id="69c7f62f-9bad-4a91-9045-b287b93c4c2f_C3_R0">Drivers (Video)</td>
    <td class="x" id="69c7f62f-9bad-4a91-9045-b287b93c4c2f_C4_R0">12/26/2018</td>
    <td class="x" id="69c7f62f-9bad-4a91-9045-b287b93c4c2f_C5_R0">n/a</td>
    <td class="x" id="69c7f62f-9bad-4a91-9045-b287b93c4c2f_C6_R0">
      <span id="69c7f62f-9bad-4a91-9045-b287b93c4c2f_size">88.9 MB</span>
      <span class="noDisplay" id="69c7f62f-9bad-4a91-9045-b287b93c4c2f_originalSize">93171419</span>
    </td>
  </tr>
  <tr id="cea2cfd7-840e-4a1d-b8eb-b1984f3db8bb_R0">
    <td id="cea2cfd7-840e-4a1d-b8eb-b1984f3db8bb_C0_R0"></td>
    <td id="cea2cfd7-840e-4a1d-b8eb-b1984f3db8bb_C1_R0">
      <a id='cea2cfd7-840e-4a1d-b8eb-b1984f3db8bb_link' href="javascript:void(0);">Dell Inc. - Display - DELL E1910H</a>
    </td>
    <td id="cea2cfd7-840e-4a1d-b8eb-b1984f3db8bb_C2_R0">Windows 7, Windows 8.1 Drivers</td>
    <td id="cea2cfd7-840e-4a1d-b8eb-b1984f3db8bb_C3_R0">Drivers (Monitor)</td>
    <td id="cea2cfd7-840e-4a1d-b8eb-b1984f3db8bb_C4_R0">18/05/2009</td>
    <td id="cea2cfd7-840e-4a1d-b8eb-b1984f3db8bb_C5_R0">1.0</td>
    <td id="cea2cfd7-840e-4a1d-b8eb-b1984f3db8bb_C6_R0">
      <span id="cea2cfd7-840e-4a1d-b8eb-b1984f3db8bb_size">23 KB</span>
      <span class="noDisplay" id="cea2cfd7-840e-4a1d-b8eb-b1984f3db8bb_originalSize">23783</span>
    </td>
  </tr>
</table>`;

test('parseResults extracts id, title, products, date, version and size', () => {
  const results = catalog.parseResults(FIXTURE);
  assert.equal(results.length, 2);
  assert.deepEqual(results[0], {
    updateId: '69c7f62f-9bad-4a91-9045-b287b93c4c2f',
    title: 'Intel Corporation - Display - 12/27/2018 12:00:00 AM - 10.18.10.5069',
    products: 'Windows 10, Windows 11 & later',
    classification: 'Drivers (Video)',
    lastUpdated: '12/26/2018',
    version: '',
    sizeBytes: 93171419,
  });
  assert.equal(results[1].sizeBytes, 23783);
  assert.equal(results[1].version, '1.0');
});

test('parseResults returns nothing for a page without results', () => {
  assert.deepEqual(catalog.parseResults('<html><body>No results found</body></html>'), []);
});

test('only Microsoft download hosts over https are accepted', () => {
  assert.equal(
    catalog.isDownloadUrl('https://catalog.s.download.windowsupdate.com/c/msdownload/update/driver/drvs/2012/12/x.cab'),
    true,
  );
  assert.equal(catalog.isDownloadUrl('https://download.windowsupdate.com/x.cab'), true);
  assert.equal(catalog.isDownloadUrl('http://catalog.s.download.windowsupdate.com/x.cab'), false);
  assert.equal(catalog.isDownloadUrl('https://evil.example.com/x.cab'), false);
  assert.equal(catalog.isDownloadUrl('https://catalog.s.download.windowsupdate.com.evil.com/x.cab'), false);
  assert.equal(catalog.isDownloadUrl('file:///C:/Windows/System32/cmd.exe'), false);
  assert.equal(catalog.isDownloadUrl('javascript:alert(1)'), false);
  assert.equal(catalog.isDownloadUrl(''), false);
});
