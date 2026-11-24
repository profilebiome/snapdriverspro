'use strict';

const path = require('node:path');
const fs = require('node:fs');
const paths = require('./paths');
const { asString } = require('./verdict');

const LEVEL_LABEL = {
  update: 'Actualización disponible',
  error: 'Con error',
  review: 'Revisar en fabricante',
  unknown: 'Sin datos',
  current: 'Al día',
};

function esc(value) {
  return asString(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shortDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function buildHtml({ rows, stats, system, catalog, generatedAt }) {
  const generated = new Date(generatedAt || Date.now());
  const systems = [
    ['Equipo', `${system.manufacturer || ''} ${system.model || ''}`.trim()],
    ['Nombre', system.computerName],
    ['Windows', `${system.osCaption || ''} · build ${system.osBuild || ''}${system.displayVersion ? ` (${system.displayVersion})` : ''}`],
    ['Procesador', system.cpu],
    ['Memoria', system.ramGb ? `${system.ramGb} GB` : ''],
    ['Arquitectura', system.architecture],
    ['BIOS', system.biosVersion],
  ].filter(([, value]) => asString(value));

  const rowHtml = rows
    .map(
      (row) => `
      <tr class="lvl-${row.verdict.level}">
        <td><span class="dot"></span>${esc(LEVEL_LABEL[row.verdict.level])}</td>
        <td><strong>${esc(row.deviceName)}</strong><div class="sub">${esc(row.deviceId)}</div></td>
        <td>${esc(row.classKey)}</td>
        <td>${esc(row.provider || '—')}</td>
        <td class="mono">${esc(row.driverVersion || '—')}</td>
        <td class="mono">${shortDate(row.driverDate)}</td>
        <td>${esc(row.verdict.reason)}</td>
        <td>${row.links?.catalogUrl ? `<a href="${esc(row.links.catalogUrl)}">Catálogo Microsoft</a>` : '—'}</td>
      </tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Informe de controladores · ${esc(system.computerName || 'PC')}</title>
<style>
  :root { color-scheme: dark; --bg:#0a0e14; --panel:#111823; --line:#1d2836; --text:#e6edf6; --muted:#8b9bb0;
          --update:#38bdf8; --error:#f87171; --review:#fbbf24; --current:#34d399; --unknown:#94a3b8; }
  * { box-sizing: border-box; }
  body { margin:0; padding:40px; background:var(--bg); color:var(--text);
         font:14px/1.55 "Segoe UI", system-ui, sans-serif; }
  h1 { font-size:24px; margin:0 0 4px; letter-spacing:-.01em; }
  .lead { color:var(--muted); margin:0 0 28px; }
  .grid { display:flex; flex-wrap:wrap; gap:12px; margin-bottom:24px; }
  .stat { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:14px 18px; min-width:132px; }
  .stat b { display:block; font-size:22px; font-variant-numeric:tabular-nums; }
  .stat span { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.08em; }
  table { width:100%; border-collapse:collapse; background:var(--panel); border:1px solid var(--line); border-radius:12px; overflow:hidden; }
  th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted);
       padding:10px 12px; border-bottom:1px solid var(--line); background:#0e151e; }
  td { padding:10px 12px; border-bottom:1px solid #16202c; vertical-align:top; }
  tr:last-child td { border-bottom:none; }
  .sub { color:var(--muted); font-size:11px; font-family:Consolas, monospace; word-break:break-all; }
  .mono { font-family:Consolas, monospace; }
  .dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:8px; background:var(--unknown); }
  .lvl-update .dot { background:var(--update); }
  .lvl-error .dot { background:var(--error); }
  .lvl-review .dot { background:var(--review); }
  .lvl-current .dot { background:var(--current); }
  a { color:#7dd3fc; }
  footer { color:var(--muted); font-size:12px; margin-top:28px; }
  dl { display:grid; grid-template-columns:max-content 1fr; gap:4px 18px; margin:0 0 28px; }
  dt { color:var(--muted); }
  dd { margin:0; }
  @media print { body { background:#fff; color:#111; padding:0; } .stat,table { border-color:#ddd; background:#fff; }
    th { background:#f4f4f5; } td { border-color:#eee; } a { color:#0645ad; } .sub { color:#555; } }
</style>
</head>
<body>
  <h1>Informe de controladores</h1>
  <p class="lead">${esc(system.computerName || 'Equipo')} · generado el ${esc(generated.toLocaleString('es-ES'))} por Snap Drivers Pro</p>
  <div class="grid">
    <div class="stat"><b>${stats.total}</b><span>Controladores</span></div>
    <div class="stat"><b>${stats.updates}</b><span>Actualizaciones</span></div>
    <div class="stat"><b>${stats.review}</b><span>Para revisar</span></div>
    <div class="stat"><b>${stats.errors}</b><span>Con error</span></div>
    <div class="stat"><b>${stats.current}</b><span>Al día</span></div>
    <div class="stat"><b>${stats.unknown}</b><span>Sin datos</span></div>
  </div>
  <dl>${systems.map(([key, value]) => `<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`).join('')}</dl>
  <table>
    <thead><tr><th>Estado</th><th>Dispositivo</th><th>Clase</th><th>Fabricante</th><th>Versión</th><th>Fecha</th><th>Motivo</th><th>Descarga</th></tr></thead>
    <tbody>${rowHtml}</tbody>
  </table>
  <footer>
    Fuente de veredictos: Windows Update, catálogo local (${catalog?.entries?.length || 0} entradas) y antigüedad del controlador.
    Los enlaces abren las páginas oficiales del fabricante o el Catálogo de Microsoft Update.
  </footer>
</body>
</html>`;
}

function csvCell(value) {
  const text = asString(value).replace(/\r?\n/g, ' ');
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildCsv({ rows }) {
  const header = [
    'Estado',
    'Dispositivo',
    'Clase',
    'Fabricante',
    'Versión instalada',
    'Fecha del controlador',
    'Fuente del veredicto',
    'Motivo',
    'Hardware ID',
    'Catálogo Microsoft Update',
    'Web del fabricante',
  ];
  const lines = rows.map((row) =>
    [
      LEVEL_LABEL[row.verdict.level] || row.verdict.level,
      row.deviceName,
      row.classKey,
      row.provider,
      row.driverVersion,
      row.driverDate ? row.driverDate.slice(0, 10) : '',
      row.verdict.source,
      row.verdict.reason,
      row.deviceId || (row.hardwareIds || [])[0] || '',
      row.links?.catalogUrl || '',
      row.links?.vendor?.url || '',
    ]
      .map(csvCell)
      .join(';'),
  );
  return `\uFEFF${[header.join(';'), ...lines].join('\r\n')}\r\n`;
}

function buildJson(model) {
  return `${JSON.stringify({ ...model, app: 'Snap Drivers Pro', exportedAt: new Date().toISOString() }, null, 2)}\n`;
}

const FORMATS = {
  html: { ext: 'html', label: 'Informe HTML', build: buildHtml },
  csv: { ext: 'csv', label: 'Hoja de cálculo CSV', build: buildCsv },
  json: { ext: 'json', label: 'Datos JSON', build: buildJson },
};

async function exportReport(parentWindow, model, format = 'html') {
  const { dialog } = require('electron');
  const spec = FORMATS[format];
  if (!spec) throw new Error(`Formato no soportado: ${format}`);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const defaultPath = path.join(paths.reportsDir(), `Drivers-Update-Pro-${stamp}.${spec.ext}`);
  const result = await dialog.showSaveDialog(parentWindow, {
    title: 'Guardar informe',
    defaultPath,
    filters: [{ name: spec.label, extensions: [spec.ext] }],
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  });
  if (result.canceled || !result.filePath) return null;
  fs.writeFileSync(result.filePath, spec.build(model), 'utf8');
  return { path: result.filePath };
}

function buildLogReport({ entries, counts, system, stats }) {
  const lines = [];
  lines.push('Snap Drivers Pro — registro de actividad');
  lines.push('Generado: ' + new Date().toLocaleString('es-ES'));
  lines.push('');
  if (system && Object.keys(system).length) {
    lines.push('Equipo: ' + [[system.manufacturer, system.productVersion || system.model].filter(Boolean).join(' '), system.serial ? `(serie ${system.serial})` : '']
      .filter(Boolean)
      .join(' '));
  }
  if (stats) {
    lines.push(
      `Último escaneo: ${stats.scannedAt || '—'} · ${stats.total || 0} controladores · ${stats.updates || 0} actualizaciones · ${stats.windowsUpdateCount ?? 0} desde Windows Update`,
    );
  }
  lines.push(`Eventos: ${counts?.total || entries.length} (info ${counts?.info || 0}, avisos ${counts?.warn || 0}, errores ${counts?.error || 0})`);
  lines.push('');
  lines.push('—'.repeat(72));
  for (const entry of entries) {
    const when = entry.at ? new Date(entry.at).toLocaleString('es-ES') : '—';
    lines.push(`[${when}] ${String(entry.level || 'info').toUpperCase().padEnd(5)} ${String(entry.area || 'app').padEnd(14)} ${entry.message}`);
    if (entry.data && Object.keys(entry.data).length) {
      lines.push('    ' + JSON.stringify(entry.data).slice(0, 600));
    }
  }
  return lines.join(String.fromCharCode(13, 10)) + String.fromCharCode(13, 10);
}

module.exports = { LEVEL_LABEL, buildHtml, buildCsv, buildJson, buildLogReport, exportReport, FORMATS };
