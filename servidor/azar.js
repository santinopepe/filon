// Azar reproducible a partir de una semilla de texto (por ejemplo, la fecha del desafío).
import { createHash } from 'node:crypto';

export function generadorConSemilla(semilla) {
  let a = createHash('sha256').update(String(semilla)).digest().readUInt32LE(0);
  return function siguiente() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mezclar(lista, semilla) {
  const azar = generadorConSemilla(semilla);
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}
