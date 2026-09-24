// Preferencias de la pantalla Ajustes. Son de este dispositivo
// (localStorage): si el navegador no deja guardar, se usan los valores
// por defecto y la app funciona igual.
const CLAVE = 'sena-ambientes.preferencias';
const POR_DEFECTO = { texto: 'normal', movimiento: 'sistema', vibrar: true };

function leer() {
  try { return { ...POR_DEFECTO, ...JSON.parse(localStorage.getItem(CLAVE) || '{}') }; } catch { return { ...POR_DEFECTO }; }
}

export function preferencia(clave) { return leer()[clave]; }

export function guardarPreferencia(clave, valor) {
  const p = { ...leer(), [clave]: valor };
  try { localStorage.setItem(CLAVE, JSON.stringify(p)); } catch { /* sin almacenamiento */ }
  aplicarPreferencias();
}

/** Refleja las preferencias en <html>: data-texto y data-movimiento (ver css/shell.css). */
export function aplicarPreferencias() {
  const p = leer();
  document.documentElement.dataset.texto = p.texto;
  document.documentElement.dataset.movimiento = p.movimiento;
}

export function movimientoReducido() {
  return leer().movimiento === 'reducido' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
