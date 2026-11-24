'use strict';

const api = window.dup;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const LEVEL_LABELS = {
  update: 'Actualizar',
  error: 'Con error',
  review: 'Revisar',
  unknown: 'Sin datos',
  current: 'Al día',
};

const CLASS_LABELS = {
  DISPLAY: 'Gráficos',
  NET: 'Red',
  MEDIA: 'Audio',
  SYSTEM: 'Sistema',
  USB: 'USB',
  HIDCLASS: 'HID',
  MOUSE: 'Ratón',
  KEYBOARD: 'Teclado',
  BLUETOOTH: 'Bluetooth',
  PRINTER: 'Impresora',
  HDC: 'Almacenamiento',
  SCSIADAPTER: 'Almacenamiento',
  DISKDRIVE: 'Disco',
  CDROM: 'Unidad óptica',
  VOLUME: 'Volumen',
  BATTERY: 'Batería',
  MONITOR: 'Monitor',
  CAMERA: 'Cámara',
  IMAGE: 'Cámara',
  FIRMWARE: 'Firmware',
  PROCESSOR: 'Procesador',
  SECURITYDEVICES: 'Seguridad',
  SMART_CARD_READERS: 'Lector de tarjetas',
  SMART_CARD_READERS_: 'Lector de tarjetas',
  SMARTCARDREADER: 'Lector de tarjetas',
  PORTS: 'Puertos',
  MODEM: 'Módem',
  SOFTWARE_DEVICE: 'Software',
  SOFTWAREDEVICE: 'Software',
  AUDIO_ENDPOINT: 'Audio',
  'AUDIO ENDPOINT': 'Audio',
  AUDIOENDPOINT: 'Audio',
  PRINTQUEUE: 'Cola de impresión',
  OTHERHARDWARE: 'Otro hardware',
  OTHER: 'Otro hardware',
  LEGACY: 'Controlador heredado',
  UNSIGNED: 'Sin firma',
  LIGHTS: 'Indicadores',
  WCEUSBSH: 'USB',
  DESCONOCIDA: 'Sin clase',
};

const state = {
  ready: false,
  scanning: false,
  phase: null,
  rows: [],
  stats: null,
  system: {},
  settings: { showSoftwareDevices: false, ageThresholdMonths: 24, createRestorePoint: true },
  catalog: { entries: [] },
  info: {},
  filters: { query: '', level: 'all', classKey: 'all', sort: 'level' },
  selection: new Set(),
  drawerKey: null,
  installTarget: null,
  installRunning: false,
  notices: { arm64: false, windowsUpdate: '', warnings: [] },
  download: { open: false, phase: 'idle', candidates: [], selected: null, progress: {}, infs: 0 },
  batch: { open: false, items: [], phase: 'idle', jobs: new Map(), installed: 0, failed: 0 },
  logs: { open: false, level: 'all', entries: [], counts: {} },
  admin: false,
  update: { status: 'idle', version: '', notes: '', percent: 0, message: '', supported: false, notifiedVersion: null },
  catalogDraft: null,
  pendingScan: [],
};

const nf = new Intl.NumberFormat('es-ES');

/* ───────────────────────────── helpers ───────────────────────────── */

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function icon(name, cls = '') {
  return `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}" /></svg>`;
}

function formatDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value <= 0) return '—';
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function classLabel(key) {
  const value = String(key || '').toUpperCase();
  return CLASS_LABELS[value] || value.toLowerCase().replace(/_/g, ' ') || 'Sin clase';
}

function levelLabel(level) {
  return LEVEL_LABELS[level] || level;
}

function isHiddenBySettings(row) {
  return row.isSoftware && !state.settings.showSoftwareDevices;
}

function unwrap(result, fallbackMessage) {
  if (!result) throw new Error(fallbackMessage || 'Operación sin respuesta.');
  if (result.ok === false) throw new Error(result.error || fallbackMessage || 'Operación fallida.');
  return result.data;
}

async function callApi(fn, ...args) {
  try {
    return unwrap(await fn(...args));
  } catch (error) {
    toast(error.message, 'bad');
    throw error;
  }
}

/** Fire-and-forget IPC: the failure is already surfaced as a toast by callApi. */
function guard(promise) {
  Promise.resolve(promise).catch(() => {});
}

function localCounts() {
  const rows = state.rows.filter((row) => !isHiddenBySettings(row));
  const counts = { update: 0, error: 0, review: 0, unknown: 0, current: 0 };
  for (const row of rows) counts[row.verdict.level] = (counts[row.verdict.level] || 0) + 1;
  return { rows, counts, total: rows.length, software: state.rows.length - rows.length };
}

function renderNotices() {
  const host = $('#notices');
  if (!host) return;
  const items = [];
  if (state.notices.arm64) {
    items.push({
      info: true,
      title: 'Equipo ARM64',
      text: 'La aplicación corre en modo x64 emulado. Los controladores siguen siendo oficiales, pero algunos fabricantes solo publican paquetes ARM64 en su web: usa la ruta del fabricante del equipo.',
    });
  }
  if (state.notices.windowsUpdate) {
    items.push({ title: 'Windows Update no respondió', text: state.notices.windowsUpdate });
  }
  if (state.notices.warnings.length) {
    items.push({ title: 'Avisos del escaneo', text: state.notices.warnings.join(' ') });
  }
  host.innerHTML = items
    .map(
      (item) => `<div class="notice${item.info ? ' notice--info' : ''}">${icon('alert')}<div><strong>${escapeHtml(
        item.title,
      )}</strong><p>${escapeHtml(item.text)}</p></div></div>`,
    )
    .join('');
}

function toast(message, kind = 'ok', timeout = 4200) {
  const host = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast${kind === 'bad' ? ' toast--bad' : kind === 'warn' ? ' toast--warn' : ''}`;
  const iconName = kind === 'bad' ? 'alert' : kind === 'warn' ? 'alert' : 'check';
  el.innerHTML = `${icon(iconName, 'toast__icon')}<span>${escapeHtml(message)}</span>`;
  host.appendChild(el);
  setTimeout(() => {
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 220);
  }, timeout);
}

async function copyText(text) {
  const value = String(text ?? '');
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    toast('Copiado al portapapeles');
  } catch {
    const area = document.createElement('textarea');
    area.value = value;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
      toast('Copiado al portapapeles');
    } catch {
      toast('No se pudo copiar', 'bad');
    }
    area.remove();
  }
}

/* ───────────────────────────── rendering ───────────────────────────── */

function renderMachine() {
  const sys = state.system || {};
  const host = state.info.host || {};
  const bits = [];
  const makerName = sys.manufacturer && !/to be filled/i.test(sys.manufacturer) ? sys.manufacturer : '';
  const product = sys.productVersion || sys.model || '';
  const maker = [makerName, product].filter(Boolean).join(' ').trim();
  if (maker) bits.push(`<b>${escapeHtml(maker)}</b>`);
  if (sys.computerName) bits.push(escapeHtml(sys.computerName));
  else if (host.hostname) bits.push(escapeHtml(host.hostname));
  const os = [sys.osCaption, sys.osBuild ? `build ${sys.osBuild}` : host.osVersion ? `Windows ${host.osVersion}` : ''].filter(Boolean).join(' · ');
  if (os) bits.push(escapeHtml(os));
  const arch = sys.architecture || host.arch;
  if (arch) bits.push(escapeHtml(String(arch).replace('X64', 'x64').replace('Arm64', 'ARM64')));
  if (sys.ramGb) bits.push(`${sys.ramGb} GB RAM`);
  else if (host.ramGb) bits.push(`${host.ramGb} GB RAM`);
  const cpu = sys.cpu || host.cpu;
  if (cpu) bits.push(escapeHtml(cpu));
  $('#machineLine').innerHTML = bits.length ? bits.join(' <span class="sep">·</span> ') : 'Sin datos del equipo todavía';
}

function renderReadout() {
  const stats = state.stats;
  const { counts, total, software } = localCounts();
  const set = (id, value) => {
    $('#' + id).textContent = value === null || value === undefined ? '—' : nf.format(value);
  };
  set('statUpdates', state.rows.length ? counts.update : undefined);
  set('statErrors', state.rows.length ? counts.error : undefined);
  set('statCurrent', state.rows.length ? counts.current : undefined);
  set('statUnknown', state.rows.length ? counts.unknown : undefined);
  set('statTotal', state.rows.length ? total : undefined);
  $('#statTotalHint').textContent = !state.rows.length
    ? 'en este equipo'
    : software
      ? `${state.rows.length} leídos · ${software} software ocultos`
      : `${total} controladores leídos`;

  const wuCount = stats?.windowsUpdateCount;
  $('#statUpdatesHint').textContent = state.scanning
    ? 'consultando Windows Update…'
    : stats && stats.updatesAvailable === false
      ? 'Windows Update no disponible'
      : wuCount === 0
        ? 'Windows Update: sin novedades'
        : wuCount
          ? `Windows Update: ${wuCount} disponible${wuCount === 1 ? '' : 's'}`
          : 'Windows Update + catálogo';

  $$('#readout .readout__cell').forEach((cell) => {
    cell.classList.toggle('is-active', state.filters.level === cell.dataset.level);
  });
}

function renderClassFilter() {
  const select = $('#classFilter');
  const current = state.filters.classKey;
  const counts = new Map();
  for (const row of state.rows) {
    if (isHiddenBySettings(row)) continue;
    counts.set(row.classKey, (counts.get(row.classKey) || 0) + 1);
  }
  const options = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'));
  select.innerHTML =
    '<option value="all">Todas las clases</option>' +
    options
      .map(
        ([key, count]) =>
          `<option value="${escapeHtml(key)}"${key === current ? ' selected' : ''}>${escapeHtml(classLabel(key))} (${count})</option>`,
      )
      .join('');
  if (!options.some(([key]) => key === current)) {
    select.value = 'all';
    state.filters.classKey = 'all';
  }
}

function sortRows(rows) {
  const { sort } = state.filters;
  const copy = [...rows];
  if (sort === 'name') {
    copy.sort((a, b) => a.deviceName.localeCompare(b.deviceName, 'es'));
  } else if (sort === 'date') {
    copy.sort((a, b) => {
      const left = a.driverDate ? new Date(a.driverDate).getTime() : Number.MAX_SAFE_INTEGER;
      const right = b.driverDate ? new Date(b.driverDate).getTime() : Number.MAX_SAFE_INTEGER;
      return left - right;
    });
  } else if (sort === 'vendor') {
    copy.sort((a, b) => (a.provider || 'zzz').localeCompare(b.provider || 'zzz', 'es') || a.deviceName.localeCompare(b.deviceName, 'es'));
  }
  return copy;
}

function visibleRows() {
  const { query, level, classKey } = state.filters;
  const needle = query.trim().toLowerCase();
  const rows = state.rows.filter((row) => {
    if (isHiddenBySettings(row)) return false;
    if (level !== 'all' && row.verdict.level !== level) return false;
    if (classKey !== 'all' && row.classKey !== classKey) return false;
    if (!needle) return true;
    const haystack = [
      row.deviceName,
      row.deviceId,
      row.provider,
      row.manufacturer,
      row.driverVersion,
      row.classKey,
      row.verdict.reason,
      ...(row.hardwareIds || []),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });
  return sortRows(rows);
}

function rowHtml(row, index) {
  const selected = state.selection.has(row.key);
  const vendor = row.links?.vendor?.name || row.provider || '—';
  const open = state.drawerKey === row.key;
  return `
    <div class="row${selected ? ' is-selected' : ''}${open ? ' is-open' : ''}" data-key="${escapeHtml(row.key)}" data-level="${row.verdict.level}" role="row" tabindex="0" style="animation-delay:${Math.min(index, 18) * 12}ms">
      <div class="cell check">
        <label class="check" title="Seleccionar">
          <input type="checkbox" data-select="${escapeHtml(row.key)}" ${selected ? 'checked' : ''} aria-label="Seleccionar ${escapeHtml(row.deviceName)}" />
          <span></span>
        </label>
      </div>
      <div class="cell"><span class="state" data-level="${row.verdict.level}">${escapeHtml(levelLabel(row.verdict.level))}</span></div>
      <div class="cell device">
        <span class="device__name" title="${escapeHtml(row.deviceName)}">${escapeHtml(row.deviceName)}</span>
        <span class="device__id" title="${escapeHtml(row.deviceId)}">${escapeHtml(row.deviceId || 'sin identificador')}</span>
      </div>
      <div class="cell cell--class"><span class="tag">${escapeHtml(classLabel(row.classKey))}</span></div>
      <div class="cell cell--version mono">${escapeHtml(row.driverVersion || '—')}</div>
      <div class="cell cell--date mono mono--dim">${escapeHtml(formatDate(row.driverDate))}</div>
      <div class="cell cell--vendor"><span class="tag" title="${escapeHtml(vendor)}">${escapeHtml(vendor)}</span></div>
      <div class="cell row__actions">
        <button class="iconbtn" data-action="catalog" data-key="${escapeHtml(row.key)}" title="Abrir la búsqueda oficial de este controlador" aria-label="Abrir descarga oficial">${icon('external')}</button>
        <button class="iconbtn" data-action="detail" data-key="${escapeHtml(row.key)}" title="Ver detalle" aria-label="Ver detalle">${icon('chevron', 'rot')}</button>
      </div>
    </div>`;
}

function skeletonHtml(count = 8) {
  const widths = [34, 62, 48, 70, 40, 55, 44, 58, 50, 66];
  return Array.from({ length: count })
    .map((_, index) => {
      const w = widths[index % widths.length];
      return `<div class="skeleton-row" aria-hidden="true">
        <span class="sk sk--box"></span>
        <span class="sk" style="width:${w}%"></span>
        <span class="sk sk--device" style="width:${Math.min(100, w + 22)}%"></span>
        <span class="sk" style="width:56%"></span>
        <span class="sk" style="width:64%"></span>
        <span class="sk" style="width:52%"></span>
        <span class="sk" style="width:48%"></span>
        <span></span>
      </div>`;
    })
    .join('');
}

function renderRows() {
  const rows = visibleRows();
  const host = $('#rows');
  const skeleton = state.scanning && state.rows.length === 0;
  $('#tableWrap').hidden = state.rows.length === 0 && !skeleton;
  $('#emptyState').hidden = state.rows.length > 0 || skeleton;
  if (skeleton) {
    const viewport = Math.max(host.clientHeight || 0, 420);
    host.innerHTML = skeletonHtml(Math.ceil(viewport / 48) + 2);
    $('#selectionInfo').textContent = 'Leyendo controladores…';
    return;
  }
  if (state.rows.length === 0) {
    host.innerHTML = '';
    renderSelection(rows);
    return;
  }
  if (rows.length === 0) {
    host.innerHTML = `<div class="empty" style="padding-top:60px"><h2>Ningún controlador coincide</h2><p>Prueba con otro filtro, otra clase o borra la búsqueda.</p><button class="btn btn--quiet" data-action="clear-filters">Quitar filtros</button></div>`;
  } else {
    host.innerHTML = rows.map(rowHtml).join('');
  }
  const selectAll = $('#selectAll');
  const selectable = rows.filter((row) => !row.isSoftware);
  selectAll.checked = selectable.length > 0 && selectable.every((row) => state.selection.has(row.key));
  selectAll.indeterminate = !selectAll.checked && selectable.some((row) => state.selection.has(row.key));
  renderSelection(rows);
}

function renderSelection(rows = visibleRows()) {
  const count = state.selection.size;
  const actionable = state.rows.filter(
    (row) =>
      !isHiddenBySettings(row) &&
      (row.verdict.level === 'update' || row.verdict.level === 'review' || row.verdict.level === 'error'),
  );
  const info = $('#selectionInfo');
  if (state.scanning && state.rows.length === 0) {
    info.textContent = 'Leyendo controladores…';
  } else if (count > 0) {
    info.innerHTML = `<b>${count}</b> seleccionado${count === 1 ? '' : 's'} · ${rows.length} visibles`;
  } else if (state.rows.length > 0) {
    info.innerHTML = `${rows.length} de ${state.rows.filter((row) => !isHiddenBySettings(row)).length} controladores visibles`;
  } else {
    info.textContent = 'Sin escanear';
  }
  const targets = count > 0 ? state.selection.size : actionable.length;
  const openBtn = $('#openUpdatesBtn');
  openBtn.disabled = targets === 0 || state.rows.length === 0;
  openBtn.innerHTML = `${icon('external')} Abrir descargas${targets ? ` (${targets})` : ''}`;
  openBtn.classList.remove('btn--primary');
  openBtn.classList.add('btn--quiet');
  const updatable = state.rows.filter(
    (row) => !isHiddenBySettings(row) && row.verdict.level === 'update' && row.links?.catalogQuery,
  );
  const batchBtn = $('#batchBtn');
  batchBtn.disabled = updatable.length === 0;
  $('#batchBtnLabel').textContent = updatable.length ? `Actualizar todo (${updatable.length})` : 'Actualizar todo';

  const scope = count > 0 ? rows : visibleRows();
  const verifiable = scope.filter((row) => row.verdict.level === 'review' || row.verdict.level === 'unknown');
  const verifyBtn = $('#verifyBtn');
  verifyBtn.disabled = verifiable.length === 0;
  verifyBtn.innerHTML = `${icon('check')} Marcar al día${verifiable.length ? ` (${verifiable.length})` : ''}`;
  verifyBtn.dataset.keys = JSON.stringify(verifiable.map((row) => row.key));
  $('#exportBtn').disabled = state.rows.length === 0;
  $('#installBtn').disabled = false;
}

function renderStatus() {
  const stats = state.stats;
  if (!stats || !stats.scannedAt) {
    $('#statusScan').textContent = state.scanning ? 'Escaneando…' : 'Sin escanear';
  } else {
    const duration = stats.durationMs ? `${(stats.durationMs / 1000).toFixed(1)} s` : '';
    $('#statusScan').textContent = `Última exploración: ${formatTime(stats.scannedAt)}${duration ? ` · ${duration}` : ''}`;
  }
  const parts = [];
  if (state.scanning && !stats?.scannedAt) parts.push('Windows Update: consultando…');
  else parts.push(`Windows Update: ${stats?.updatesAvailable ? `${stats?.windowsUpdateCount ?? 0} controladores` : stats?.scannedAt ? 'no disponible' : 'sin consultar'}`);
  parts.push(`Catálogo: ${state.catalog.entries.filter((entry) => entry.latestVersion).length}/${state.catalog.entries.length} con versión`);
  if (stats?.softwareTotal) parts.push(`Software: ${state.settings.showSoftwareDevices ? 'visible' : 'oculto'}`);
  $('#statusSources').textContent = parts.join(' · ');
  $('#statusData').textContent = state.info.isPortable ? 'Modo portable · datos junto al .exe' : 'Datos en el perfil de usuario';
  $('#statusData').title = state.info.dataRoot || '';
}

function renderAll() {
  document.body.classList.toggle('is-blank', state.rows.length === 0 && !state.scanning);
  renderMachine();
  renderReadout();
  renderClassFilter();
  renderRows();
  renderStatus();
}

function renderScanState() {
  const btn = $('#scanBtn');
  btn.classList.toggle('is-busy', state.scanning);
  btn.disabled = false;
  const hasRows = state.rows.length > 0;
  btn.classList.toggle('btn--ghost', hasRows || state.scanning);
  btn.classList.toggle('btn--primary', !hasRows && !state.scanning);
  $('#scanBtnLabel').textContent = state.scanning
    ? 'Cancelar escaneo'
    : state.rows.length
      ? 'Volver a escanear'
      : 'Escanear equipo';
  $('#progress').hidden = !state.scanning;
  if (state.scanning) {
    const labels = {
      devices: 'Leyendo dispositivos y versiones instaladas…',
      updates: 'Consultando Windows Update, puede tardar un poco…',
      merge: 'Cruzando versiones con las fuentes oficiales…',
    };
    $('#machineLine').textContent = labels[state.phase] || 'Preparando el escaneo…';
  }
  renderStatus();
}

/* ───────────────────────────── drawer ───────────────────────────── */

let overlayTimer = null;

function overlayVisible() {
  return (
    $$('.modal, .install-modal').some((node) => node.classList.contains('is-open')) ||
    $('#drawer').classList.contains('is-open')
  );
}

function syncOverlay() {
  const scrim = $('#scrim');
  if (overlayTimer) {
    clearTimeout(overlayTimer);
    overlayTimer = null;
  }
  if (overlayVisible()) {
    scrim.hidden = false;
    requestAnimationFrame(() => scrim.classList.add('is-open'));
    return;
  }
  scrim.classList.remove('is-open');
  overlayTimer = setTimeout(() => {
    overlayTimer = null;
    if (!overlayVisible()) scrim.hidden = true;
  }, 220);
}

function openDrawer(key) {
  const row = state.rows.find((item) => item.key === key);
  if (!row) return;
  state.drawerKey = key;
  renderDrawer();
  $$('.row').forEach((el) => el.classList.toggle('is-open', el.dataset.key === key));
  const drawer = $('#drawer');
  drawer.hidden = false;
  requestAnimationFrame(() => {
    drawer.classList.add('is-open');
    syncOverlay();
  });
}

function closeDrawer() {
  state.drawerKey = null;
  const drawer = $('#drawer');
  drawer.classList.remove('is-open');
  $$('.row').forEach((el) => el.classList.remove('is-open'));
  syncOverlay();
  setTimeout(() => {
    if (!drawer.classList.contains('is-open')) drawer.hidden = true;
  }, 240);
}

function legacyRoutes(links) {
  if (!links) return [];
  const routes = [];
  if (links.vendor?.url) {
    routes.push({ id: 'chip', label: links.vendor.name || 'Fabricante del componente', url: links.vendor.url, note: 'fabricante del componente', primary: true });
  }
  if (links.oem?.url) {
    routes.push({ id: 'oem', label: links.oem.name || 'Fabricante del equipo', url: links.oem.url, note: 'soporte del equipo', primary: routes.length === 0 });
  }
  if (links.catalogUrl) {
    routes.push({ id: 'catalog', label: 'Catálogo de Microsoft Update', url: links.catalogUrl, note: links.catalogQuery || '', primary: false });
  }
  if (links.windowsUpdateUrl) {
    routes.push({ id: 'wu', label: 'Windows Update', url: links.windowsUpdateUrl, note: 'buscar actualizaciones del sistema', primary: false });
  }
  return routes;
}

function renderDrawer() {
  const row = state.rows.find((item) => item.key === state.drawerKey);
  if (!row) return;
  const badge = $('#drawerBadge');
  badge.textContent = levelLabel(row.verdict.level);
  badge.dataset.level = row.verdict.level;
  $('#drawerTitle').textContent = row.deviceName;
  $('#drawerSub').textContent = row.deviceId || 'sin identificador de dispositivo';

  const kv = [
    ['Versión', row.driverVersion || '—'],
    ['Fecha', formatDate(row.driverDate)],
    ['Clase', classLabel(row.classKey)],
    ['Fabricante', row.manufacturer || row.provider || '—'],
    ['Proveedor', row.provider || '—'],
    ['Firma', row.isSigned ? row.signer || 'Firmado' : row.installed ? 'Sin firma verificada' : '—'],
    ['INF', row.infName || '—'],
    ['Estado PnP', row.status || (row.errorCode ? `Código ${row.errorCode}` : 'OK')],
  ].filter(([, value]) => value && value !== '—');

  const routes = Array.isArray(row.links?.routes) && row.links.routes.length ? row.links.routes : legacyRoutes(row.links);
  const routeIcon = { chip: 'cpu', oem: 'device', catalog: 'search', wu: 'shield' };
  const linksHtml = routes
    .map(
      (route) => `<button class="linkrow linkrow--${route.id}${route.primary ? ' linkrow--primary' : ''}" data-action="open-route" data-route="${route.id}" data-key="${escapeHtml(row.key)}">
           <span class="linkrow__icon">${icon(routeIcon[route.id] || 'external')}</span>
           <span class="linkrow__text"><b>${escapeHtml(route.label)}</b><small>${escapeHtml(route.note || '')}</small></span>
           <span class="linkrow__chev">${icon('external')}</span>
         </button>`,
    )
    .join('');

  const sys = state.system || {};
  const equipment = [
    ['Equipo', [sys.manufacturer, sys.productVersion || sys.model].filter(Boolean).join(' ').trim()],
    ['Modelo', sys.model],
    ['Número de serie', sys.serial],
    ['BIOS', [sys.biosVersion, sys.biosDate ? formatDate(sys.biosDate) : ''].filter(Boolean).join(' · ')],
  ].filter(([, value]) => value && value !== '—' && value !== ' ');
  const equipmentHtml = equipment.length
    ? `<div class="section">
         <h3 class="section__title">Equipo</h3>
         <dl class="kv">${equipment
           .map(
             ([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}${
               key === 'Número de serie' || key === 'Modelo'
                 ? ` <button class="iconbtn iconbtn--inline" data-action="copy" data-copy="${escapeHtml(value)}" title="Copiar" aria-label="Copiar ${escapeHtml(key)}">${icon('copy')}</button>`
                 : ''
             }</dd>`,
           )
           .join('')}</dl>
       </div>`
    : '';

  const updateHtml = row.update
    ? `<div class="section">
         <h3 class="section__title">Paquete ofrecido por Windows Update</h3>
         <dl class="kv">
           <dt>Proveedor</dt><dd>${escapeHtml(row.update.provider || '—')}</dd>
           <dt>Título</dt><dd>${escapeHtml(row.update.title || '—')}</dd>
           <dt>Fecha</dt><dd>${escapeHtml(formatDate(row.update.driverDate))}</dd>
           <dt>Tamaño</dt><dd>${escapeHtml(formatBytes(row.update.sizeBytes))}</dd>
           <dt>Reinicio</dt><dd>${row.update.rebootRequired ? 'Puede requerirlo' : 'No necesario'}</dd>
         </dl>
       </div>`
    : '';

  const hardwareHtml = (row.hardwareIds || []).length
    ? `<div class="section">
         <h3 class="section__title">Hardware IDs</h3>
         <div class="hw-list">
           ${row.hardwareIds
             .map(
               (id) => `<div class="hw"><span title="${escapeHtml(id)}">${escapeHtml(id)}</span>
                 <button class="iconbtn" data-action="copy" data-copy="${escapeHtml(id)}" title="Copiar" aria-label="Copiar hardware ID">${icon('copy')}</button></div>`,
             )
             .join('')}
         </div>
       </div>`
    : '';

  const installedHtml = row.installed
    ? `<div class="section">
      <h3 class="section__title">Instalado en este equipo</h3>
      <dl class="kv">${kv.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd class="${key === 'Versión' ? 'mono' : ''}">${escapeHtml(value)}</dd>`).join('')}</dl>
    </div>`
    : `<div class="section">
      <h3 class="section__title">Estado</h3>
      <p class="field__help">No hay un controlador instalado registrado para este hardware ID en este equipo. Windows Update ofrece un paquete compatible; descárgalo desde el Catálogo de Microsoft Update y instálalo con «Instalar paquete».</p>
    </div>`;

  $('#drawerBody').innerHTML = `
    <p class="reason" style="--level: var(--c-${row.verdict.level})">${escapeHtml(row.verdict.reason)}</p>
    ${installedHtml}
    ${updateHtml}
    ${equipmentHtml}
    <div class="section">
      <h3 class="section__title">Rutas oficiales</h3>
      ${linksHtml}
      <button class="btn btn--quiet dl-open" data-action="open-download" data-key="${escapeHtml(row.key)}">
        ${icon('download')} Descargar paquete del Catálogo de Microsoft
      </button>
      <p class="field__help">En clases del sistema (chipset, audio, touchpad, almacenamiento) manda el fabricante del equipo; en GPU, red y Bluetooth manda el fabricante del chip. La descarga se hace desde catalog.update.microsoft.com y el paquete se instala en local con tu confirmación.</p>
    </div>
    ${hardwareHtml}
  `;

  const primaryRoute = routes[0] || null;
  const canVerify = row.verdict.level === 'review' || row.verdict.level === 'unknown';
  const canProbe = row.verdict.source !== 'catalog-package';
  $('#drawerFoot').innerHTML = `
    ${canProbe ? `<button class="btn btn--quiet" data-action="probe" data-key="${escapeHtml(row.key)}">${icon('search')} Comprobar versión</button>` : ''}
    <button class="btn btn--primary" data-action="open-download" data-key="${escapeHtml(row.key)}">
      ${icon('download')} Descargar e instalar
    </button>`;
}

/* ───────────────────────────── settings ───────────────────────────── */

function renderCatalogEditor() {
  const entries = state.catalogDraft || [];
  const host = $('#catalogList');
  host.innerHTML =
    entries
      .map(
        (entry, index) => `
      <div class="catalog__row" data-index="${index}">
        <div class="catalog__fields">
          <div class="catalog__line">
            <input data-field="vendor" placeholder="Fabricante (Intel)" value="${escapeHtml(entry.vendor)}" aria-label="Fabricante" />
            <input data-field="deviceClass" placeholder="Clase (DISPLAY)" value="${escapeHtml(entry.deviceClass)}" aria-label="Clase" />
          </div>
          <input data-field="matchPattern" placeholder="Patrón: intel.*graphics" value="${escapeHtml(entry.matchPattern)}" aria-label="Patrón" />
        </div>
        <input class="catalog__version" data-field="latestVersion" placeholder="Última versión" value="${escapeHtml(entry.latestVersion || '')}" aria-label="Última versión" />
        <button class="iconbtn" data-catalog-remove="${index}" title="Quitar" aria-label="Quitar entrada">${icon('close')}</button>
      </div>`,
      )
      .join('') || '<p class="field__help">Sin entradas en el catálogo.</p>';
}

function openSettings() {
  const settings = state.settings;
  $('#ageThreshold').value = settings.ageThresholdMonths;
  $('#restoreToggle').checked = settings.createRestorePoint !== false;
  state.catalogDraft = state.catalog.entries.map((entry) => ({ ...entry }));
  renderCatalogEditor();
  $('#aboutVersion').textContent = `Snap Drivers Pro ${state.info.version || ''}`.trim();
  $('#aboutPath').textContent = state.info.dataRoot || '';
  openModal('#settingsModal');
}

function collectCatalogDraft() {
  const rows = $$('#catalogList .catalog__row');
  return rows.map((row, index) => {
    const read = (field) => (row.querySelector(`[data-field="${field}"]`)?.value || '').trim();
    return {
      id: state.catalogDraft[index]?.id || `entrada-${Date.now()}-${index}`,
      vendor: read('vendor'),
      deviceClass: read('deviceClass').toUpperCase(),
      matchPattern: read('matchPattern'),
      latestVersion: read('latestVersion') || null,
      sourceUrl: state.catalogDraft[index]?.sourceUrl || '',
      lastReviewed: new Date().toISOString().slice(0, 10),
      notes: state.catalogDraft[index]?.notes || '',
    };
  });
}

function openModal(selector) {
  const el = $(selector);
  el.hidden = false;
  requestAnimationFrame(() => {
    el.classList.add('is-open');
    syncOverlay();
  });
}

function closeModal(selector) {
  const el = $(selector);
  el.classList.remove('is-open');
  syncOverlay();
  setTimeout(() => {
    if (!el.classList.contains('is-open')) el.hidden = true;
  }, 190);
}

/* ───────────────────────────── scan flow ───────────────────────────── */

function startScan() {
  if (state.scanning) return;
  state.scanning = true;
  state.phase = 'devices';
  state.selection.clear();
  document.body.classList.remove('is-blank');
  state.notices.windowsUpdate = '';
  state.notices.warnings = [];
  renderNotices();
  renderScanState();
  renderRows();
  guard(
    api.startScan().then((result) => {
      if (result && result.ok === false) {
        state.scanning = false;
        renderScanState();
        toast(result.error, 'bad');
      }
    }),
  );
}

async function cancelScan() {
  await api.cancelScan();
  state.scanning = false;
  state.phase = null;
  renderScanState();
  renderRows();
  renderMachine();
  toast('Escaneo cancelado. Los resultados que ya había siguen visibles.', 'warn');
}

function onScanEvent(event) {
  if (!event || !event.type) return;
  if (event.type === 'phase') {
    state.phase = event.phase;
    renderScanState();
    return;
  }
  if (event.type === 'partial') {
    state.rows = event.rows || [];
    state.stats = event.stats || null;
    state.system = event.system || {};
    state.notices.warnings = Array.isArray(event.warnings) ? event.warnings : [];
    renderAll();
    renderNotices();
    renderScanState();
    return;
  }
  if (event.type === 'complete') {
    state.rows = event.rows || [];
    state.stats = event.stats || null;
    state.system = event.system || {};
    if (event.catalog) state.catalog = event.catalog;
    state.scanning = false;
    state.phase = null;
    renderAll();
    renderScanState();
    const updates = state.stats?.updates || 0;
    toast(
      updates > 0
        ? `Escaneo completado: ${updates} actualización${updates === 1 ? '' : 'es'} disponible${updates === 1 ? '' : 's'}.`
        : `Escaneo completado: ${state.stats?.total || 0} controladores revisados, ninguno requiere actualización.`,
      updates > 0 ? 'warn' : 'ok',
    );
    state.notices.windowsUpdate = state.stats?.windowsUpdateError || '';
    state.notices.warnings = Array.isArray(event.warnings) ? event.warnings : [];
    if (state.system?.architecture && /arm/i.test(String(state.system.architecture))) state.notices.arm64 = true;
    renderNotices();
    state.pendingScan.splice(0).forEach((resolve) => resolve(true));
    return;
  }
  if (event.type === 'error') {
    state.scanning = false;
    state.phase = null;
    renderScanState();
    toast(event.message || 'El escaneo falló', 'bad', 8000);
    state.pendingScan.splice(0).forEach((resolve) => resolve(false));
  }
}

/* ───────────────────────────── hardware inventory ───────────────────────────── */

const HARDWARE_GROUPS = [
  ['cpu', 'Procesador'],
  ['gpu', 'Gráficos'],
  ['memory', 'Memoria'],
  ['storage', 'Almacenamiento'],
  ['network', 'Red'],
  ['audio', 'Audio'],
  ['battery', 'Batería'],
];

function renderHardware() {
  const hardware = state.system?.hardware || {};
  const groups = HARDWARE_GROUPS.filter(([key]) => Array.isArray(hardware[key]) && hardware[key].length > 0);
  const body = $('#hardwareBody');
  if (groups.length === 0) {
    body.innerHTML =
      '<p class="dl-status">Todavía no hay inventario. Pulsa «Escanear equipo» para leer los componentes.</p>';
    return;
  }
  body.innerHTML = groups
    .map(
      ([key, label]) => `<div class="hwgroup">
        <h3 class="section__title">${escapeHtml(label)}</h3>
        ${hardware[key]
          .map(
            (item) => `<div class="hwitem">
              <span class="hwitem__name">${escapeHtml(item.name || 'Sin nombre')}</span>
              <span class="hwitem__meta">${escapeHtml(
                [item.vendor, item.version, item.extra].filter(Boolean).join(' · '),
              )}</span>
            </div>`,
          )
          .join('')}
      </div>`,
    )
    .join('');
}

function openHardware() {
  const sys = state.system || {};
  $('#hardwareSub').textContent = [sys.manufacturer, sys.productVersion || sys.model, sys.serial ? `serie ${sys.serial}` : '']
    .filter(Boolean)
    .join(' · ') || 'Inventario leído del sistema';
  renderHardware();
  openModal('#hardwareModal');
}

/* ───────────────────────────── catalog download ───────────────────────────── */

function downloadPhase() {
  return state.download.phase;
}

function openDownload(rowKey) {
  const row = state.rows.find((item) => item.key === rowKey);
  if (!row) return;
  state.download = {
    open: true,
    rowKey,
    deviceName: row.deviceName,
    query: row.links?.catalogQuery || '',
    candidates: [],
    selected: null,
    jobId: null,
    cabPath: null,
    dir: null,
    phase: 'searching',
    message: '',
    progress: { percent: 0, received: 0, total: 0 },
    infs: 0,
    searchToken: 0,
  };
  $('#downloadSub').textContent = state.download.query || 'Catálogo de Microsoft Update';
  renderDownload();
  openModal('#downloadModal');
  searchDownloads();
}

async function searchDownloads() {
  const dl = state.download;
  const rowKey = dl.rowKey;
  dl.searchToken = (dl.searchToken || 0) + 1;
  const token = dl.searchToken;
  dl.phase = 'searching';
  dl.message = '';
  renderDownload();
  const result = await callApi(api.searchDownloads, rowKey).catch(() => null);
  // A slower answer for a modal that was closed or replaced must never win.
  if (state.download !== dl || !dl.open || token !== dl.searchToken) return;
  if (!result) {
    dl.phase = 'error';
    dl.message = 'No se pudo consultar el catálogo.';
    renderDownload();
    return;
  }
  if (result.blocked) {
    dl.phase = 'error';
    dl.message = 'Microsoft pidió una verificación anti-robot. Espera unos minutos y vuelve a intentarlo.';
    renderDownload();
    return;
  }
  dl.candidates = result.results || [];
  dl.selected = dl.candidates[0] || null;
  dl.phase = dl.candidates.length ? 'candidates' : 'empty';
  renderDownload();
}

function renderDownload() {
  const dl = state.download;
  const body = $('#downloadBody');
  const primary = $('#downloadPrimary');
  const hint = $('#downloadHint');
  primary.className = 'btn btn--primary';
  primary.disabled = false;

  if (dl.phase === 'searching') {
    body.innerHTML = `<p class="dl-status">Consultando el Catálogo de Microsoft Update para <code>${escapeHtml(dl.query || 'el hardware ID')}</code>…</p><div class="dl-progress dl-progress--wait"><span></span></div>`;
    primary.textContent = 'Descargar';
    primary.disabled = true;
    hint.textContent = 'Buscando paquetes oficiales';
    return;
  }

  if (dl.phase === 'empty') {
    body.innerHTML = `<div class="dl-empty"><strong>Microsoft no tiene paquetes para este hardware ID.</strong><p>Usa la ruta del fabricante del equipo o del componente para descargar el paquete.</p></div>`;
    primary.textContent = 'Descargar';
    primary.disabled = true;
    hint.textContent = 'Sin resultados';
    return;
  }

  if (dl.phase === 'error') {
    body.innerHTML = `<div class="dl-empty dl-empty--bad"><strong>No se pudo completar la descarga.</strong><p>${escapeHtml(dl.message || 'Error desconocido.')}</p></div>`;
    primary.textContent = 'Reintentar';
    hint.textContent = '';
    return;
  }

  if (dl.phase === 'candidates') {
    body.innerHTML = `
      <p class="dl-status">Microsoft ofrece ${dl.candidates.length} paquete${dl.candidates.length === 1 ? '' : 's'} para este dispositivo. Elige el que corresponda a tu versión de Windows.</p>
      <div class="dl-list">
        ${dl.candidates
          .map(
            (item) => `<label class="dl-row${dl.selected && dl.selected.updateId === item.updateId ? ' is-selected' : ''}">
              <input type="radio" name="dl-candidate" value="${escapeHtml(item.updateId)}" ${dl.selected && dl.selected.updateId === item.updateId ? 'checked' : ''} />
              <span class="dl-main">
                <b>${escapeHtml(item.title || 'Paquete de controlador')}</b>
                <small>${escapeHtml(item.products || 'productos no indicados')}</small>
              </span>
              <span class="dl-meta">${escapeHtml(item.lastUpdated || '')}<br />${item.sizeBytes ? formatBytes(item.sizeBytes) : 'tamaño desconocido'}</span>
            </label>`,
          )
          .join('')}
      </div>
      <p class="field__help">Se descarga el CAB firmado que Microsoft publica en catalog.update.microsoft.com y se extrae en tu carpeta de datos. Nada se instala hasta que lo confirmes.</p>`;
    primary.textContent = 'Descargar paquete';
    hint.textContent = dl.selected ? formatBytes(dl.selected.sizeBytes) : '';
    return;
  }

  if (dl.phase === 'downloading') {
    const p = dl.progress;
    body.innerHTML = `
      <p class="dl-status">Descargando el paquete oficial${p.percent !== null && p.percent !== undefined ? ` · ${p.percent}%` : ''}</p>
      <div class="dl-progress"><span style="width:${p.percent || 0}%"></span></div>
      <p class="dl-meta-line">${formatBytes(p.received)}${p.total ? ` de ${formatBytes(p.total)}` : ''} · catalog.update.microsoft.com</p>`;
    primary.textContent = 'Descargando…';
    primary.disabled = true;
    hint.textContent = 'No cierres la ventana';
    return;
  }

  if (dl.phase === 'downloaded') {
    body.innerHTML = `
      <div class="dl-done">
        ${icon('check')}
        <div><strong>Paquete descargado</strong><p class="dl-meta-line">${escapeHtml(dl.cabPath || '')}</p></div>
      </div>
      <p class="field__help">Se extraerá el contenido y se instalará con <code>pnputil</code> y permisos de administrador. Puedes borrar la carpeta de descargas cuando termines.</p>`;
    primary.textContent = 'Extraer e instalar';
    hint.textContent = 'Requiere UAC';
    return;
  }

  if (dl.phase === 'working') {
    body.innerHTML = `<p class="dl-status">${escapeHtml(dl.message || 'Trabajando…')}</p><div class="dl-progress dl-progress--wait"><span></span></div>`;
    primary.textContent = 'Instalando…';
    primary.disabled = true;
    hint.textContent = 'No cierres la ventana';
    return;
  }

  if (dl.phase === 'done') {
    body.innerHTML = `
      <div class="dl-done">
        ${icon('check')}
        <div><strong>Controlador instalado</strong><p class="dl-meta-line">${dl.infs} archivo${dl.infs === 1 ? '' : 's'} .inf extraído${dl.infs === 1 ? '' : 's'} · pnputil terminó correctamente</p></div>
      </div>
      <p class="field__help">Vuelve a escanear para confirmar la nueva versión. Si el paquete requería reinicio, Windows lo pedirá.</p>`;
    primary.textContent = 'Abrir carpeta de descargas';
    hint.textContent = 'Listo';
    return;
  }
}

function beginDownload() {
  const dl = state.download;
  if (!dl.selected) return;
  dl.phase = 'downloading';
  dl.progress = { percent: 0, received: 0, total: dl.selected.sizeBytes || 0 };
  dl.jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  renderDownload();
  guard(
    callApi(api.startDownload, {
      rowKey: dl.rowKey,
      updateId: dl.selected.updateId,
      title: dl.selected.title,
      jobId: dl.jobId,
    })
      .then((file) => {
        if (!file) {
          dl.phase = 'error';
          dl.message = 'La descarga no devolvió ningún archivo.';
        } else {
          dl.cabPath = file.path;
          dl.phase = 'downloaded';
        }
        renderDownload();
      })
      .catch((error) => {
        dl.phase = 'error';
        dl.message = error.message;
        renderDownload();
      }),
  );
}

async function installDownloaded() {
  const dl = state.download;
  if (!dl.cabPath) return;
  dl.phase = 'working';
  dl.message = 'Extrayendo el paquete…';
  renderDownload();
  const extracted = await callApi(api.extractDownload, dl.cabPath).catch(() => null);
  if (!extracted) {
    dl.phase = 'error';
    dl.message = 'No se pudo extraer el paquete descargado.';
    renderDownload();
    return;
  }
  dl.dir = extracted.dir;
  dl.infs = extracted.infs;
  dl.message = 'Instalando con permisos de administrador…';
  renderDownload();
  const row = state.rows.find((item) => item.key === dl.rowKey);
  const singleTargets = [{ path: extracted.dir, label: row?.deviceName || 'Paquete', hardwareIds: row?.hardwareIds || [] }];
  const result = await callApi(api.installBatch, singleTargets, state.settings.createRestorePoint).catch(() => null);
  if (result && result.needsElevation) {
    await callApi(api.savePending, { items: singleTargets, autoInstall: true }).catch(() => null);
    toast('Reiniciando la app como administrador para instalar…', 'warn', 6000);
    await callApi(api.relaunchElevated).catch(() => null);
    return;
  }
  const single = result?.results?.[0] || null;
  if (result && single && (single.status === 'reboot' || single.status === 'no-device')) {
    dl.phase = 'done';
    renderDownload();
    toast(
      single.status === 'reboot'
        ? 'Controlador instalado. Reinicia el equipo para completarlo.'
        : 'Paquete añadido al almacén. Windows no encontró el dispositivo ahora mismo; reinicia y vuelve a escanear.',
      'warn',
      9000,
    );
    guard(loadLogs());
    return;
  }
  if (!result || !single || !single.ok) {
    dl.phase = 'error';
    dl.message = single
      ? single.exitCode > 0
        ? `pnputil devolvió el código ${single.exitCode}. ${String(single.output || '').slice(0, 400)}`
        : String(single.output || 'No se pudo instalar el paquete.').slice(0, 400)
      : 'La instalación elevada no se completó.';
    renderDownload();
    return;
  }
  dl.phase = 'done';
  renderDownload();
  toast('Controlador descargado e instalado.', 'ok');
  guard(loadLogs());
}

function closeDownloadModal() {
  const dl = state.download;
  dl.open = false;
  if (dl.phase === 'downloading' && dl.jobId) guard(api.cancelDownload(dl.jobId));
  closeModal('#downloadModal');
}

function closeBatch() {
  const batch = state.batch;
  batch.open = false;
  for (const jobId of batch.jobs.keys()) guard(api.cancelDownload(jobId));
  batch.jobs.clear();
  closeModal('#batchModal');
}

function onDownloadEvent(event) {
  if (!event || event.type !== 'download') return;
  const batchItem = state.batch.jobs.get(event.jobId);
  if (batchItem && event.phase === 'downloading') {
    batchItem.percent = event.percent || 0;
    if (state.batch.open) renderBatch();
    return;
  }
  const dl = state.download;
  if (!dl.open || event.jobId !== dl.jobId) return;
  if (event.phase === 'downloading') {
    dl.progress = { percent: event.percent || 0, received: event.received || 0, total: event.total || 0 };
    if (dl.phase === 'downloading') renderDownload();
  }
}

/* ───────────────────────────── updates ───────────────────────────── */

function renderUpdatePill() {
  const update = state.update;
  const pill = $('#updatePill');
  const badge = $('#settingsBadge');
  if (!pill) return;
  let text = '';
  if (update.status === 'available') text = `Actualización ${update.version || 'disponible'}`;
  else if (update.status === 'downloading') text = `Descargando ${update.percent || 0}%`;
  else if (update.status === 'downloaded') text = 'Reiniciar para instalar';
  const show = Boolean(text);
  pill.hidden = !show;
  if (show) $('#updatePillText').textContent = text;
  if (badge) badge.hidden = !show;
}

function readUpdate(payload) {
  const update = state.update;
  if (!payload || !payload.status) return;
  update.status = payload.status;
  if (payload.version) update.version = payload.version;
  if (typeof payload.notes === 'string') update.notes = payload.notes;
  if (typeof payload.percent === 'number') update.percent = payload.percent;
  if (payload.message) update.message = payload.message;
  renderUpdatePill();
  if (payload.status === 'available') {
    renderUpdate();
    if (update.notifiedVersion !== update.version) {
      update.notifiedVersion = update.version;
      openModal('#updateModal');
    }
    return;
  }
  if (['downloading', 'downloaded', 'error', 'latest'].includes(payload.status)) renderUpdatePill();
  if (['downloading', 'downloaded', 'error'].includes(payload.status)) {
    if ($('#updateModal').classList.contains('is-open')) renderUpdate();
    return;
  }
  if (payload.status === 'latest' && $('#updateModal').classList.contains('is-open')) renderUpdate();
}

function renderUpdate() {
  const update = state.update;
  const body = $('#updateBody');
  const primary = $('#updatePrimary');
  const hint = $('#updateHint');

  if (update.status === 'available') {
    $('#updateTitle').textContent = 'Actualización disponible';
    $('#updateSub').textContent = `Versión ${update.version || ''} · ahora tienes ${state.info.version || ''}`;
    body.innerHTML = `
      <p class="dl-status">Hay una versión nueva de Snap Drivers Pro lista para instalar.</p>
      ${update.notes ? `<div class="update-notes">${escapeHtml(update.notes)}</div>` : ''}
      <p class="field__help">Se descarga desde GitHub, se instala sola y conserva tus ajustes, catálogo y descargas.</p>`;
    primary.textContent = 'Instalar actualización';
    primary.disabled = false;
    hint.textContent = 'Se reiniciará al terminar';
    return;
  }

  if (update.status === 'downloading') {
    $('#updateTitle').textContent = 'Descargando actualización';
    body.innerHTML = `
      <p class="dl-status">Descargando la versión ${escapeHtml(update.version || '')} · ${update.percent || 0}%</p>
      <div class="dl-progress"><span style="width:${update.percent || 0}%"></span></div>
      <p class="dl-meta-line">Snap Drivers Pro se reiniciará para aplicar la actualización.</p>`;
    primary.textContent = 'Descargando…';
    primary.disabled = true;
    hint.textContent = 'No cierres la ventana';
    return;
  }

  if (update.status === 'downloaded') {
    $('#updateTitle').textContent = 'Lista para instalar';
    body.innerHTML = `
      <div class="dl-done">${icon('check')}<div><strong>Versión ${escapeHtml(update.version || '')} descargada</strong><p class="dl-meta-line">Se aplicará al reiniciar la aplicación.</p></div></div>`;
    primary.textContent = 'Reiniciar e instalar';
    primary.disabled = false;
    hint.textContent = 'La app se cerrará y volverá a abrir';
    return;
  }

  if (update.status === 'latest') {
    $('#updateTitle').textContent = 'Estás al día';
    $('#updateSub').textContent = `Versión ${state.info.version || ''}`;
    body.innerHTML = '<p class="dl-status">No hay una versión más nueva publicada.</p>';
    primary.textContent = 'Cerrar';
    primary.disabled = false;
    hint.textContent = '';
    return;
  }

  if (update.status === 'loading') {
    body.innerHTML = `<p class="dl-status">Consultando GitHub Releases…</p><div class="dl-progress dl-progress--wait"><span></span></div>`;
    primary.textContent = 'Buscar actualizaciones';
    primary.disabled = true;
    hint.textContent = '';
    return;
  }

  $('#updateTitle').textContent = 'Actualización';
  body.innerHTML = `<div class="dl-empty dl-empty--bad"><strong>No se pudo actualizar.</strong><p>${escapeHtml(
    update.message || 'Error desconocido.',
  )}</p><p class="field__help">Comprueba tu conexión. Si el problema sigue, descarga la última versión desde la web oficial.</p></div>`;
  primary.textContent = 'Reintentar';
  primary.disabled = false;
  hint.textContent = '';
}

async function checkUpdates({ silent = false } = {}) {
  state.update.status = 'loading';
  state.update.message = '';
  if (!silent) renderUpdate();
  const result = await callApi(api.checkUpdates).catch(() => null);
  if (!result) return;
  if (result.status === 'dev') {
    state.update.status = 'latest';
    if (!silent) {
      $('#updateTitle').textContent = 'Estás al día';
      $('#updateSub').textContent = `Versión ${state.info.version || ''} · modo desarrollo`;
      renderUpdate();
      openModal('#updateModal');
    }
    return;
  }
  if (result.status === 'error') {
    state.update.status = 'error';
    state.update.message = result.message || '';
    if (!silent) renderUpdate();
  }
}

/* ───────────────────────────── activity log ───────────────────────────── */

const LOG_LEVEL_LABEL = { info: 'INFO', warn: 'AVISO', error: 'ERROR' };

async function loadLogs() {
  const result = await callApi(api.getLogs, 400, state.logs.level).catch(() => null);
  if (!result) return;
  state.logs.entries = result.entries || [];
  state.logs.counts = result.counts || {};
  renderLogs();
}

function renderLogs() {
  const { entries, counts } = state.logs;
  $('#logsCounts').textContent = `${counts.total || 0} eventos · ${counts.warn || 0} avisos · ${counts.error || 0} errores`;
  const list = $('#logsList');
  if (!entries.length) {
    list.innerHTML = '<p class="dl-status">Sin eventos todavía. Escanea o descarga un paquete para empezar.</p>';
    return;
  }
  list.innerHTML = entries
    .slice()
    .reverse()
    .map((entry) => {
      const when = entry.at ? new Date(entry.at).toLocaleString('es-ES', { hour12: false }) : '—';
      return `<div class="log-row log-row--${escapeHtml(entry.level || 'info')}">
        <span class="log-time">${escapeHtml(when)}</span>
        <span class="log-level">${escapeHtml(LOG_LEVEL_LABEL[entry.level] || 'INFO')}</span>
        <span class="log-area">${escapeHtml(entry.area || 'app')}</span>
        <span class="log-msg">${escapeHtml(entry.message)}</span>
      </div>`;
    })
    .join('');
}

function openLogs() {
  state.logs.open = true;
  renderLogs();
  openModal('#logsModal');
  guard(loadLogs());
}

/* ───────────────────────────── batch update ───────────────────────────── */

async function resumePendingInstall() {
  const pending = await callApi(api.takePending).catch(() => null);
  if (!pending || !Array.isArray(pending.items) || pending.items.length === 0) return;
  state.batch = {
    open: true,
    phase: 'ready',
    jobs: new Map(),
    installed: 0,
    failed: 0,
    items: pending.items.map((item) => ({
      rowKey: '',
      label: item.label || 'Paquete',
      vendor: '',
      status: 'ready',
      message: 'Extraído · listo para instalar',
      percent: 100,
      dir: item.path,
      hardwareIds: item.hardwareIds || [],
    })),
  };
  $('#batchSub').textContent = `${state.batch.items.length} paquete(s) pendientes · instalación silenciosa`;
  renderBatch();
  openModal('#batchModal');
  if (pending.autoInstall && state.admin) guard(installBatch());
}

const BATCH_LIMIT = 10;

function pickCandidate(results) {
  const score = (item) => {
    let value = 0;
    if (/windows 1[01]|windows next/i.test(item.products || '')) value += 4;
    if (/driver/i.test(item.classification || '')) value += 1;
    value += Math.min(3, (item.sizeBytes || 0) / (200 * 1024 * 1024));
    return value;
  };
  return [...(results || [])].sort((a, b) => score(b) - score(a) || (b.sizeBytes || 0) - (a.sizeBytes || 0))[0] || null;
}

function batchUpdatable() {
  return state.rows.filter(
    (row) => !isHiddenBySettings(row) && row.verdict.level === 'update' && row.links?.catalogQuery,
  );
}

function openBatch() {
  const rows = batchUpdatable().slice(0, BATCH_LIMIT);
  if (rows.length === 0) {
    toast('No hay actualizaciones con paquete en el catálogo de Microsoft.', 'warn');
    return;
  }
  state.batch = {
    open: true,
    phase: 'downloading',
    jobs: new Map(),
    installed: 0,
    failed: 0,
    items: rows.map((row) => ({
      rowKey: row.key,
      label: row.deviceName,
      vendor: row.links?.vendor?.name || row.provider || '',
      status: 'pending',
      message: 'En cola',
      percent: 0,
      dir: null,
      hardwareIds: row.hardwareIds || [],
    })),
  };
  $('#batchSub').textContent = `${rows.length} dispositivo${rows.length === 1 ? '' : 's'} · un solo permiso de administrador al final`;
  renderBatch();
  openModal('#batchModal');
  guard(runBatchDownloads());
}

async function runBatchDownloads() {
  const batch = state.batch;
  for (const item of batch.items) {
    if (!batch.open) return;
    item.status = 'searching';
    item.message = 'Buscando paquete en el catálogo…';
    renderBatch();
    const result = await callApi(api.searchDownloads, item.rowKey).catch(() => null);
    if (!batch.open) return;
    if (!result || !result.results || result.results.length === 0) {
      item.status = 'error';
      item.message = result?.blocked ? 'Microsoft pidió verificación anti-robot' : 'Microsoft no tiene paquete para este dispositivo';
      renderBatch();
      continue;
    }
    const best = pickCandidate(result.results);
    item.status = 'downloading';
    item.message = best.title;
    item.percent = 0;
    renderBatch();
    const jobId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    batch.jobs.set(jobId, item);
    const file = await callApi(api.startDownload, {
      rowKey: item.rowKey,
      updateId: best.updateId,
      title: best.title,
      jobId,
    }).catch(() => null);
    batch.jobs.delete(jobId);
    if (!batch.open) return;
    if (!file) {
      item.status = 'error';
      item.message = 'La descarga falló';
      renderBatch();
      continue;
    }
    item.status = 'extracting';
    item.message = 'Extrayendo el paquete…';
    renderBatch();
    const extracted = await callApi(api.extractDownload, file.path).catch(() => null);
    if (!extracted) {
      item.status = 'error';
      item.message = 'No se pudo extraer el paquete';
      renderBatch();
      continue;
    }
    item.dir = extracted.dir;
    item.status = 'ready';
    item.message = `${extracted.infs} archivo${extracted.infs === 1 ? '' : 's'} .inf · ${formatBytes(file.sizeBytes)}`;
    renderBatch();
  }
  batch.phase = batch.items.some((item) => item.status === 'ready') ? 'ready' : 'done';
  batch.failed = batch.items.filter((item) => item.status === 'error').length;
  renderBatch();
}

async function installBatch() {
  const batch = state.batch;
  const ready = batch.items.filter((item) => item.status === 'ready');
  if (ready.length === 0) return;
  batch.phase = 'installing';
  renderBatch();
  const targets = ready.map((item) => ({ path: item.dir, label: item.label, hardwareIds: item.hardwareIds }));
  const result = await callApi(api.installBatch, targets, state.settings.createRestorePoint).catch(() => null);
  if (result && result.needsElevation) {
    await callApi(api.savePending, { items: targets, autoInstall: true }).catch(() => null);
    toast('Reiniciando la app como administrador para instalar sin ventanas de consola…', 'warn', 6000);
    await callApi(api.relaunchElevated).catch(() => null);
    return;
  }
  if (!result) {
    batch.phase = 'done';
    batch.failed += ready.length;
    renderBatch();
    return;
  }
  const results = Array.isArray(result.results) ? result.results : [];
  ready.forEach((item, index) => {
    const entry = results[index];
    if (!entry) return;
    const outcome = entry.status || (entry.ok ? 'ok' : 'error');
    item.status =
      outcome === 'ok' ? 'installed' : outcome === 'reboot' ? 'reboot' : outcome === 'no-device' ? 'no-device' : 'error';
    if (item.status !== 'error') {
      const row = state.rows.find((candidate) => candidate.key === item.rowKey);
      if (row) {
        row.verdict = {
          level: 'current',
          source: 'install',
          latestVersion: null,
          updateId: null,
          reason:
            item.status === 'reboot'
              ? 'Instalado por Snap Drivers Pro; reinicia el equipo para completarlo.'
              : item.status === 'no-device'
                ? 'Paquete añadido al almacén por Snap Drivers Pro; Windows lo asociará al reiniciar.'
                : 'Instalado por Snap Drivers Pro. Windows Update ya no ofrece nada más nuevo.',
        };
      }
    }
    if (outcome === 'ok') {
      item.message = `Instalado · ${entry.added} paquete(s) · ${entry.infs} .inf aplicable(s)`;
    } else if (outcome === 'reboot') {
      item.message = 'Instalado · reinicia para completarlo';
    } else if (outcome === 'no-device') {
      item.message = 'Añadido al almacén · Windows no encontró el dispositivo ahora';
    } else {
      item.message =
        entry.exitCode > 0
          ? `pnputil devolvió ${entry.exitCode}${entry.failed ? ` (${entry.failed} fallidos)` : ''}`
          : String(entry.output || 'No se pudo instalar').slice(0, 160);
    }
  });
  batch.phase = 'done';
  batch.installed = Number(result.installed) || 0;
  batch.failed = (batch.failed || 0) + (Number(result.failed) || 0);
  batch.rebootRequired = Boolean(result.rebootRequired);
  renderBatch();
  renderAll();
  const rebootHint = batch.rebootRequired ? ' Reinicia el equipo para completar la instalación.' : '';
  toast(
    batch.failed > 0
      ? `Actualización terminada: ${batch.installed} correcto(s), ${batch.failed} con error.${rebootHint}`
      : `Actualización terminada: ${batch.installed} controlador(es) instalado(s).${rebootHint}`,
    batch.failed > 0 ? 'warn' : 'ok',
    9000,
  );
  guard(loadLogs());
}

function renderBatch() {
  const batch = state.batch;
  const body = $('#batchBody');
  const primary = $('#batchPrimary');
  const hint = $('#batchHint');
  const statusLabel = {
    pending: 'En cola',
    searching: 'Buscando',
    downloading: 'Descargando',
    extracting: 'Extrayendo',
    ready: 'Listo',
    installed: 'Instalado',
    reboot: 'Reiniciar',
    'no-device': 'Sin dispositivo',
    error: 'Error',
  };
  body.innerHTML = `<div class="batch-list">${batch.items
    .map(
      (item) => `<div class="batch-row batch-row--${item.status}">
        <span class="batch-state">${escapeHtml(statusLabel[item.status] || item.status)}</span>
        <span class="batch-main">
          <b>${escapeHtml(item.label)}</b>
          <small>${escapeHtml(item.message || '')}${item.status === 'downloading' ? ` · ${item.percent || 0}%` : ''}</small>
          ${item.status === 'downloading' ? `<span class="dl-progress dl-progress--thin"><span style="width:${item.percent || 0}%"></span></span>` : ''}
        </span>
      </div>`,
    )
    .join('')}</div>`;

  const ready = batch.items.filter((item) => item.status === 'ready').length;
  if (batch.phase === 'downloading') {
    primary.textContent = `Descargando ${batch.items.filter((i) => ['ready', 'installed', 'error'].includes(i.status)).length}/${batch.items.length}…`;
    primary.disabled = true;
    hint.textContent = 'Los paquetes vienen de catalog.update.microsoft.com';
    return;
  }
  if (batch.phase === 'ready') {
    primary.textContent = `Instalar ${ready} paquete${ready === 1 ? '' : 's'} (1 permiso)`;
    primary.disabled = ready === 0;
    hint.textContent = state.admin
      ? 'Instalación silenciosa: la app ya corre como administrador'
      : 'Se reiniciará como administrador (1 solo permiso, sin ventanas de consola)';
    return;
  }
  if (batch.phase === 'installing') {
    primary.textContent = 'Instalando…';
    primary.disabled = true;
    hint.textContent = 'No cierres la ventana';
    return;
  }
  primary.textContent = 'Cerrar';
  primary.disabled = false;
  hint.textContent = batch.installed || batch.failed ? `${batch.installed} instalado(s) · ${batch.failed} con error` : '';
}

/* ───────────────────────────── install flow ───────────────────────────── */

function openInstall() {
  state.installTarget = null;
  $('#pickedPath').innerHTML = `${icon('file')}<span>Ningún paquete elegido</span>`;
  $('#installRestore').checked = state.settings.createRestorePoint !== false;
  $('#installLog').hidden = true;
  $('#installLog').className = 'install-log';
  $('#installLog').textContent = '';
  $('#runInstallBtn').disabled = true;
  $('#installHint').textContent = '';
  openModal('#installModal');
}

function setInstallTarget(target) {
  state.installTarget = target;
  $('#pickedPath').innerHTML = `${icon('folder')}<span>${escapeHtml(target.path)}</span>`;
  $('#runInstallBtn').disabled = false;
  $('#installHint').textContent = target.name || '';
}

async function runInstall() {
  if (!state.installTarget || state.installRunning) return;
  state.installRunning = true;
  const button = $('#runInstallBtn');
  button.disabled = true;
  button.classList.add('is-busy');
  const log = $('#installLog');
  log.hidden = false;
  log.className = 'install-log';
  log.textContent = 'Solicitando permisos de administrador…\n';
  try {
    const result = await callApi(api.install, state.installTarget.path, $('#installRestore').checked);
    const lines = [];
    for (const step of result.steps || []) {
      lines.push(`${step.step === 'restore-point' ? '▸ Punto de restauración' : '▸ pnputil'}: ${step.message || ''}`);
    }
    if (!result.output) lines.push('(sin salida de pnputil)');
    else lines.push(result.output);
    log.textContent = lines.join('\n');
    log.classList.add(result.ok ? 'is-ok' : 'is-bad');
    if (result.warning) {
      log.textContent += `

⚠ ${result.warning}`;
      toast(result.warning, 'warn', 8000);
    } else {
      const summary = result.ok
      ? result.installed > 0
        ? `Paquete aplicado (${result.installed} ${result.installed === 1 ? 'controlador' : 'controladores'}).`
        : 'pnputil terminó sin errores, pero no informó de paquetes nuevos.'
      : `pnputil devolvió el código ${result.exitCode}${result.failed ? ` (${result.failed} fallidos)` : ''}.`;
    toast(summary, result.ok ? 'ok' : 'bad', 7000);
    }
    if (result.ok) {
      $('#installHint').textContent = result.rebootHint ? 'Puede requerir reinicio' : 'Listo para volver a escanear';
    }
  } catch (error) {
    log.textContent = String(error.message || error);
    log.classList.add('is-bad');
  } finally {
    state.installRunning = false;
    button.classList.remove('is-busy');
    button.disabled = false;
  }
}

/* ───────────────────────────── selection ───────────────────────────── */

function toggleSelection(key, checked) {
  if (checked) state.selection.add(key);
  else state.selection.delete(key);
  renderRows();
}

function selectedOrActionable() {
  if (state.selection.size > 0) return [...state.selection];
  return visibleRows()
    .filter((row) => row.verdict.level === 'update' || row.verdict.level === 'review' || row.verdict.level === 'error')
    .map((row) => row.key);
}

/* ───────────────────────────── events ───────────────────────────── */

function bindEvents() {
  api.onScanEvent(onScanEvent);
  api.onDownloadEvent(onDownloadEvent);
  api.onUpdateEvent(readUpdate);

  $$('[data-window]').forEach((button) => {
    button.addEventListener('click', () => api.windowControl(button.dataset.window));
  });

  $('#scanBtn').addEventListener('click', () => (state.scanning ? cancelScan() : startScan()));
  $('#emptyScanBtn').addEventListener('click', startScan);

  $('#searchInput').addEventListener('input', (event) => {
    state.filters.query = event.target.value;
    renderRows();
  });

  $('#levelChips').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-level]');
    if (!chip) return;
    setLevel(chip.dataset.level);
  });

  $$('#readout .readout__cell[data-level]').forEach((cell) => {
    cell.addEventListener('click', () => setLevel(state.filters.level === cell.dataset.level ? 'all' : cell.dataset.level));
  });

  $('#classFilter').addEventListener('change', (event) => {
    state.filters.classKey = event.target.value;
    renderRows();
  });

  $('#sortSelect').addEventListener('change', (event) => {
    state.filters.sort = event.target.value;
    renderRows();
  });

  $('#softwareToggle').addEventListener('change', async (event) => {
    state.settings.showSoftwareDevices = event.target.checked;
    renderAll();
    try {
      await api.saveSettings({ showSoftwareDevices: event.target.checked });
    } catch {
      /* preferencia local aunque falle el guardado */
    }
  });

  $('#selectAll').addEventListener('change', (event) => {
    const rows = visibleRows().filter((row) => !row.isSoftware);
    if (event.target.checked) rows.forEach((row) => state.selection.add(row.key));
    else rows.forEach((row) => state.selection.delete(row.key));
    renderRows();
  });

  $('#rows').addEventListener('click', (event) => {
    const checkbox = event.target.closest('[data-select]');
    if (checkbox) {
      event.stopPropagation();
      toggleSelection(checkbox.dataset.select, checkbox.checked);
      return;
    }
    const action = event.target.closest('[data-action]');
    if (action) {
      event.stopPropagation();
      handleRowAction(action.dataset.action, action.dataset.key, action.dataset.route);
      return;
    }
    const row = event.target.closest('.row');
    if (row) openDrawer(row.dataset.key);
  });

  $('#rows').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const row = event.target.closest('.row');
    if (!row) return;
    event.preventDefault();
    openDrawer(row.dataset.key);
  });

  $('#drawer').addEventListener('click', (event) => {
    const copy = event.target.closest('[data-copy]');
    if (copy) {
      copyText(copy.dataset.copy);
      return;
    }
    const action = event.target.closest('[data-action]');
    if (!action) return;
    if (action.dataset.action === 'install-package') {
      openInstall();
      return;
    }
    handleRowAction(action.dataset.action, action.dataset.key || state.drawerKey, action.dataset.route);
  });

  $('#drawerClose').addEventListener('click', closeDrawer);
  $('#scrim').addEventListener('click', () => {
    if ($$('.modal, .install-modal').some((node) => node.classList.contains('is-open'))) return;
    closeDrawer();
  });

  $('#openUpdatesBtn').addEventListener('click', async () => {
    const keys = selectedOrActionable();
    if (keys.length === 0) {
      toast('No hay controladores con descarga disponible en esta vista.', 'warn');
      return;
    }
    const result = await callApi(api.openLinks, keys, 'catalog').catch(() => null);
    if (!result) return;
    toast(
      result.opened > 0
        ? `Abiertas ${result.opened} búsqueda${result.opened === 1 ? '' : 's'} en el Catálogo de Microsoft Update.`
        : 'Esos controladores no tienen hardware ID con búsqueda en el catálogo.',
      result.opened > 0 ? 'ok' : 'warn',
    );
  });

  $('#installBtn').addEventListener('click', openInstall);
  $('#installClose').addEventListener('click', () => closeModal('#installModal'));
  $('#pickFileBtn').addEventListener('click', () =>
    guard(
      callApi(api.pickPackage).then((target) => {
        if (target) setInstallTarget(target);
      }),
    ),
  );
  $('#pickFolderBtn').addEventListener('click', () =>
    guard(
      callApi(api.pickFolder).then((target) => {
        if (target) setInstallTarget(target);
      }),
    ),
  );
  $('#deviceManagerBtn').addEventListener('click', () => guard(callApi(api.openDeviceManager)));
  $('#runInstallBtn').addEventListener('click', () => guard(runInstall()));

  $('#downloadClose').addEventListener('click', () => closeDownloadModal());
  $('#batchBtn').addEventListener('click', openBatch);
  $('#verifyBtn').addEventListener('click', () => {
    const keys = JSON.parse($('#verifyBtn').dataset.keys || '[]');
    guard(markVerified(keys));
  });
  $('#batchClose').addEventListener('click', closeBatch);
  $('#batchPrimary').addEventListener('click', () => {
    if (state.batch.phase === 'ready') guard(installBatch());
    else if (state.batch.phase === 'done') closeBatch();
  });
  $('#downloadPrimary').addEventListener('click', () => {
    const phase = state.download.phase;
    if (phase === 'candidates') beginDownload();
    else if (phase === 'downloaded') guard(installDownloaded());
    else if (phase === 'done') guard(callApi(api.openDownloadsFolder));
    else if (phase === 'error') guard(searchDownloads());
  });
  $('#downloadBody').addEventListener('change', (event) => {
    const radio = event.target.closest('input[name="dl-candidate"]');
    if (!radio) return;
    state.download.selected = state.download.candidates.find((item) => item.updateId === radio.value) || null;
    renderDownload();
  });

  $('#exportBtn').addEventListener('click', (event) => {
    event.stopPropagation();
    const menu = $('#exportMenu');
    const open = menu.hidden;
    menu.hidden = !open;
    $('#exportBtn').setAttribute('aria-expanded', String(open));
  });
  $('#exportMenu').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-export]');
    if (!button) return;
    $('#exportMenu').hidden = true;
    const result = await callApi(api.exportReport, button.dataset.export).catch(() => null);
    if (result?.path) toast(`Informe guardado en ${result.path}`);
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.menu-wrap')) $('#exportMenu').hidden = true;
  });

  $('#settingsBtn').addEventListener('click', openSettings);
  $('#settingsClose').addEventListener('click', () => closeModal('#settingsModal'));
  $('#settingsCloseFoot').addEventListener('click', () => closeModal('#settingsModal'));

  $('#ageThreshold').addEventListener('change', async (event) => {
    const value = Number(event.target.value);
    state.settings.ageThresholdMonths = value;
    await api.saveSettings({ ageThresholdMonths: value });
  });
  $('#restoreToggle').addEventListener('change', async (event) => {
    state.settings.createRestorePoint = event.target.checked;
    await api.saveSettings({ createRestorePoint: event.target.checked });
  });

  $('#catalogAddBtn').addEventListener('click', () => {
    state.catalogDraft = collectCatalogDraft();
    state.catalogDraft.push({
      id: `entrada-${Date.now()}`,
      vendor: '',
      deviceClass: '',
      matchPattern: '',
      latestVersion: '',
      sourceUrl: '',
      notes: '',
    });
    renderCatalogEditor();
  });

  $('#catalogList').addEventListener('click', (event) => {
    const remove = event.target.closest('[data-catalog-remove]');
    if (!remove) return;
    state.catalogDraft = collectCatalogDraft();
    state.catalogDraft.splice(Number(remove.dataset.catalogRemove), 1);
    renderCatalogEditor();
  });

  $('#catalogSaveBtn').addEventListener('click', async () => {
    const entries = collectCatalogDraft();
    const saved = await callApi(api.saveCatalog, entries);
    state.catalog = saved;
    state.catalogDraft = saved.entries.map((entry) => ({ ...entry }));
    renderCatalogEditor();
    renderStatus();
    toast('Catálogo guardado. Vuelve a escanear para aplicar las versiones.');
  });

  $('#catalogFolderBtn').addEventListener('click', () => guard(callApi(api.openCatalogFolder)));
  $('#openFolderBtn').addEventListener('click', () => guard(callApi(api.openReportsFolder)));
  $('#hardwareBtn').addEventListener('click', openHardware);
  $('#logsBtn').addEventListener('click', openLogs);
  $('#logsClose').addEventListener('click', () => {
    state.logs.open = false;
    closeModal('#logsModal');
  });
  $('#logsRefresh').addEventListener('click', () => guard(loadLogs()));
  $('#logsClear').addEventListener('click', () => guard(callApi(api.clearLogs).then(() => loadLogs())));
  $('#logsFolder').addEventListener('click', () => guard(callApi(api.openLogsFolder)));
  $('#logsExportTxt').addEventListener('click', () => guard(callApi(api.exportLogs, 'txt')));
  $('#logsExportJson').addEventListener('click', () => guard(callApi(api.exportLogs, 'json')));

  $('#updateClose').addEventListener('click', () => closeModal('#updateModal'));
  $('#updateLater').addEventListener('click', () => closeModal('#updateModal'));
  $('#updatePill').addEventListener('click', () => {
    renderUpdate();
    openModal('#updateModal');
  });
  $('#updatePrimary').addEventListener('click', () => {
    if (state.update.status === 'available') {
      state.update.status = 'downloading';
      state.update.percent = 0;
      renderUpdate();
      guard(callApi(api.downloadUpdate));
    } else if (state.update.status === 'downloaded') {
      guard(callApi(api.installUpdate));
    } else if (state.update.status === 'error') {
      guard(checkUpdates());
    } else if (state.update.status === 'latest') {
      closeModal('#updateModal');
    }
  });
  $('#checkUpdatesBtn').addEventListener('click', () => guard(api.getUpdatesInfo().then((info) => {
    state.update.supported = Boolean(info?.supported);
    if (!info?.supported) {
      toast('Las actualizaciones automáticas solo funcionan en la versión instalada.', 'warn');
      return;
    }
    return checkUpdates();
  })));
  document.querySelector('.logs-filters').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-log-level]');
    if (!chip) return;
    state.logs.level = chip.dataset.logLevel;
    $$('.logs-filters .chip').forEach((node) => node.classList.toggle('is-active', node === chip));
    guard(loadLogs());
  });
  $('#hardwareClose').addEventListener('click', () => closeModal('#hardwareModal'));
  $('#hardwareDone').addEventListener('click', () => closeModal('#hardwareModal'));
  $('#aboutBtn').addEventListener('click', () => guard(callApi(api.about)));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if ($$('.modal, .install-modal').some((node) => node.classList.contains('is-open'))) {
        if ($('#settingsModal').classList.contains('is-open')) closeModal('#settingsModal');
        if ($('#installModal').classList.contains('is-open')) closeModal('#installModal');
        if ($('#downloadModal').classList.contains('is-open')) closeDownloadModal();
        if ($('#batchModal').classList.contains('is-open')) closeBatch();
        if ($('#hardwareModal').classList.contains('is-open')) closeModal('#hardwareModal');
        return;
      }
      if (state.drawerKey) closeDrawer();
      return;
    }
    if (event.key === '/' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f')) {
      event.preventDefault();
      $('#searchInput').focus();
      $('#searchInput').select();
    }
  });
}

function setLevel(level) {
  state.filters.level = level;
  $$('#levelChips .chip').forEach((chip) => chip.classList.toggle('is-active', chip.dataset.level === level));
  renderReadout();
  renderRows();
}

async function probeVersion(key) {
  const row = state.rows.find((candidate) => candidate.key === key);
  if (!row) return;
  toast('Consultando la última versión publicada en el catálogo…', 'warn', 3000);
  const result = await callApi(api.probeVersion, key).catch(() => null);
  if (!result) return;
  if (!result.found) {
    toast(result.reason || 'No se pudo comprobar la versión.', 'warn', 7000);
    return;
  }
  row.verdict = result.verdict;
  renderAll();
  if (state.drawerKey === key) renderDrawer();
  const reference = result.reference;
  toast(
    row.verdict.level === 'update'
      ? `Hay una versión más nueva: ${reference.version} (${formatDate(reference.date)}).`
      : `Última versión publicada: ${reference.version} (${formatDate(reference.date)}). Estás al día.`,
    row.verdict.level === 'update' ? 'warn' : 'ok',
    8000,
  );
  guard(loadLogs());
}

async function markVerified(keys) {
  const list = (Array.isArray(keys) ? keys : [keys]).filter(Boolean);
  if (list.length === 0) return;
  const result = await callApi(api.verifyRows, list, true).catch(() => null);
  if (!result) return;
  for (const item of result.updated || []) {
    const row = state.rows.find((candidate) => candidate.key === item.key);
    if (row) row.verdict = item.verdict;
  }
  state.selection.clear();
  renderAll();
  toast(
    result.count === 1
      ? 'Controlador marcado como al día.'
      : `${result.count} controladores marcados como al día.`,
    'ok',
  );
  guard(loadLogs());
}

function handleRowAction(action, key, route) {
  if (!key) return;
  if (action === 'detail') {
    openDrawer(key);
    return;
  }
  if (action === 'open-download') {
    openDownload(key);
    return;
  }
  if (action === 'verify') {
    guard(markVerified([key]));
    return;
  }
  if (action === 'probe') {
    guard(probeVersion(key));
    return;
  }
  const legacy = { 'open-vendor': 'chip', 'open-oem': 'oem', 'open-wu': 'wu', 'open-catalog': 'catalog', catalog: 'catalog' };
  const target = route || legacy[action];
  if (!target) return;
  guard(callApi(api.openLink, key, target));
}

/* ───────────────────────────── boot ───────────────────────────── */

async function boot() {
  const info = unwrap(await api.bootstrap(), 'No se pudo iniciar la aplicación.');
  state.info = info;
  state.settings = { ...state.settings, ...(info.settings || {}) };
  state.admin = Boolean(info.elevated);
  state.catalog = info.catalog || { entries: [] };
  $('#softwareToggle').checked = Boolean(state.settings.showSoftwareDevices);
  $('#portablePill').hidden = !info.isPortable;
  $('#statTotalHint').textContent = 'en este equipo';

  if (String(info.host?.osArch || '').toLowerCase().includes('arm')) {
    state.notices.arm64 = true;
    renderNotices();
  }

  if (info.previous?.rows?.length) {
    state.rows = info.previous.rows;
    state.stats = info.previous.stats;
    state.system = info.previous.system || {};
    toast('Mostrando el último escaneo guardado. Pulsa «Escanear» para actualizarlo.', 'warn', 6000);
  }

  bindEvents();
  renderAll();
  guard(loadLogs());
  guard(resumePendingInstall());
  renderScanState();
  state.ready = true;
}

/* screenshot harness (only in --screenshot mode) */

if (typeof location !== 'undefined' && location.search.includes('screenshot=1')) {
  window.__dupShots = {
    startScan: () => {
      startScan();
      return true;
    },
    waitForScan: () =>
      new Promise((resolve) => {
        if (!state.scanning) resolve(true);
        else state.pendingScan.push(resolve);
      }),
    openFirstRow: () => {
      const row =
        state.rows.find((item) => item.verdict.level === 'update') ||
        state.rows.find((item) => item.verdict.level === 'review') ||
        state.rows[0];
      if (row) openDrawer(row.key);
      return true;
    },
    openSettings: () => {
      closeDrawer();
      openSettings();
      return true;
    },
    filterUpdates: () => {
      closeModal('#settingsModal');
      setLevel('update');
      return true;
    },
    openInstall: () => {
      closeModal('#settingsModal');
      closeDrawer();
      openInstall();
      return true;
    },
    closeDrawer: () => {
      closeDrawer();
      return true;
    },
    scrollDrawer: () => {
      const body = $('#drawerBody');
      body.scrollTop = body.scrollHeight;
      return true;
    },
    openBatch: () => {
      openBatch();
      return true;
    },
    openDownload: () => {
      const row = state.rows.find((item) => item.verdict.level === 'update') || state.rows[0];
      if (row) {
        closeDrawer();
        openDownload(row.key);
      }
      return true;
    },
    openExportMenu: () => {
      closeModal('#installModal');
      $('#exportMenu').hidden = false;
      return true;
    },
  };
}

document.addEventListener('DOMContentLoaded', () => {
  boot().catch((error) => {
    console.error(error);
    toast(error.message || 'Error al iniciar', 'bad', 9000);
  });
});
