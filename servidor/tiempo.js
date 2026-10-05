// Utilidades de fecha y hora para la zona del desafío (por defecto America/Argentina/Buenos_Aires).
// El "día de juego" se define por la fecha local de esa zona: el desafío cambia a las 00:00 locales.

const formateadores = new Map();

function formateador(zona) {
  let f = formateadores.get(zona);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: zona,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formateadores.set(zona, f);
  }
  return f;
}

export function partesLocales(ms, zona) {
  const partes = {};
  for (const p of formateador(zona).formatToParts(new Date(ms))) partes[p.type] = p.value;
  return {
    anio: Number(partes.year),
    mes: Number(partes.month),
    dia: Number(partes.day),
    hora: Number(partes.hour),
    minuto: Number(partes.minute),
    segundo: Number(partes.second),
  };
}

const dos = (n) => String(n).padStart(2, '0');

/** Fecha local "AAAA-MM-DD" en la zona indicada. */
export function fechaLocal(ms, zona) {
  const p = partesLocales(ms, zona);
  return `${p.anio}-${dos(p.mes)}-${dos(p.dia)}`;
}

/** Diferencia (ms) entre la hora local de la zona y UTC en el instante dado. */
function desfase(ms, zona) {
  const p = partesLocales(ms, zona);
  const comoUtc = Date.UTC(p.anio, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  return comoUtc - Math.floor(ms / 1000) * 1000;
}

export function esFechaValida(fecha) {
  if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  const [a, m, d] = fecha.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Instante (ms) de las 00:00 locales de la fecha dada. */
export function inicioDeFecha(fecha, zona) {
  const [a, m, d] = fecha.split('-').map(Number);
  const supuesto = Date.UTC(a, m - 1, d);
  const primero = supuesto - desfase(supuesto, zona);
  return supuesto - desfase(primero, zona);
}

export function sumarDias(fecha, n) {
  const [a, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

export function diasEntre(desde, hasta) {
  const [a1, m1, d1] = desde.split('-').map(Number);
  const [a2, m2, d2] = hasta.split('-').map(Number);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000);
}

/** Instante de la próxima medianoche local posterior a `ms`. */
export function proximaMedianoche(ms, zona) {
  return inicioDeFecha(sumarDias(fechaLocal(ms, zona), 1), zona);
}
