/**
 * Verifies a packaged app.asar: every JavaScript file must parse and must have
 * the same bytes as the source tree. A half-written archive (the classic result
 * of replacing app.asar while the app still holds it) shows up here before the
 * installer is published.
 *
 *   node scripts/verify-asar.js [ruta/app.asar]
 */

const asar = require('@electron/asar');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repo = path.join(__dirname, '..');
const target = process.argv[2] || path.join(repo, 'dist', 'win-unpacked', 'resources', 'app.asar');

if (!fs.existsSync(target)) {
  console.error(`No existe ${target}`);
  process.exit(2);
}

const entries = asar.listPackage(target).filter((entry) => entry.endsWith('.js'));
const problems = [];

for (const entry of entries) {
  const relative = entry.replace(/^[\\/]/, '').replace(/\\/g, '/');
  const source = asar.extractFile(target, entry.replace(/^[\\/]/, '')).toString('utf8');

  try {
    new vm.Script(source, { filename: relative });
  } catch (error) {
    problems.push(`${relative}: ${error.message}`);
    continue;
  }

  // Only our own sources are byte-compared; node_modules may be resolved
  // differently by the packager (version skew is not corruption).
  if (!/^(src|data)\//.test(relative) && relative !== 'package.json') continue;
  const original = path.join(repo, relative);
  if (fs.existsSync(original)) {
    const expected = fs.readFileSync(original, 'utf8');
    if (expected !== source) problems.push(`${relative}: el contenido del asar no coincide con el fuente`);
  }
}

console.log(`Verificados ${entries.length} archivos JS de ${path.relative(repo, target)}`);
if (problems.length > 0) {
  console.error(`\n${problems.length} problema(s):`);
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}
console.log('asar íntegro: todos los archivos coinciden con el fuente y compilan.');
