/**
 * Maps a pnputil exit code to a user-facing outcome.
 * 3010/1641 are SUCCESS codes that only ask for a reboot, and 259 means the
 * package reached the driver store but no device claimed it right now.
 */
function classifyPnputil(code) {
  const value = Number(code);
  if (value === 0) return { status: 'ok', ok: true, rebootRequired: false, reason: '' };
  if (value === 3010 || value === 1641) {
    return { status: 'reboot', ok: true, rebootRequired: true, reason: 'Reinicia para completar la instalación.' };
  }
  if (value === 259) {
    return {
      status: 'no-device',
      ok: true,
      rebootRequired: false,
      reason: 'El paquete se añadió al almacén de controladores, pero Windows no encontró ahora mismo un dispositivo que lo use.',
    };
  }
  if (value === 5) return { status: 'error', ok: false, rebootRequired: false, reason: 'Windows denegó el acceso (se necesita administrador).' };
  return { status: 'error', ok: false, rebootRequired: false, reason: `pnputil devolvió el código ${value}.` };
}

module.exports = { classifyPnputil };
