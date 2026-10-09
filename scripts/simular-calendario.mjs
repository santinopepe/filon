#!/usr/bin/env node
// Simulación del calendario del generador por catálogos sobre una base TEMPORAL (no toca producción ni la
// reserva real): publica días consecutivos de Normal y mide días completos, uso de la reserva, fallos,
// variedad, dificultad y repeticiones (ninguna consigna equivalente a menos de la ventana).
//
//   npm run simular-calendario                              # 180 días desde mañana, ventana 60
//   npm run simular-calendario -- --dias 365 --semilla otra --inicio 2026-12-01
//   npm run simular-calendario -- --manuales 7 --futuros 3  # con historial manual previo y días ya programados
//   npm run simular-calendario -- --json salida.json        # además, el informe completo en un archivo
//   npm run simular-calendario -- --modo geografia          # el modo Geografía (siete preguntas de geografía por día)
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cargarConfig } from '../servidor/config.js';
import { abrirBD } from '../servidor/db.js';
import { cargarReserva } from '../servidor/generador/reserva.js';
import { asegurarDesafio } from '../servidor/generador/generar.js';
import { CATEGORIAS } from '../servidor/dominio.js';
import { diasEntre, fechaLocal, sumarDias } from '../servidor/tiempo.js';

import { POR_OMISION, jaccard, jaccardEstimado } from '../servidor/catalogos/generador.js';

const args = process.argv.slice(2);
const valor = (f, def) => (args.includes(f) ? args[args.indexOf(f) + 1] : def);
const dir = mkdtempSync(join(tmpdir(), 'filon-calendario-'));
const config = cargarConfig({
  sinArchivoEnv: true,
  env: {
    RUTA_BD: join(dir, 'calendario.db'), BD_URL: '', TURSO_DATABASE_URL: '',
    CATALOGOS_SEMILLA: valor('--semilla', 'simulacion'),
    CATALOGOS_DIAS_SIN_REPETIR: valor('--ventana', '60'),
    CATALOGOS_COMPLETAR_CON_RESERVA: '1',
    CATALOGOS_DIAS_ROTACION: valor('--rotacion-dias', String(POR_OMISION.diasRotacion)),
    CATALOGOS_PESO_ROTACION: valor('--rotacion-peso', String(POR_OMISION.pesoRotacion)),
  },
});
const dias = Number(valor('--dias', 180));
const inicio = valor('--inicio', sumarDias(fechaLocal(Date.now(), config.zona), 1));
const manuales = Number(valor('--manuales', 0));
const futuros = Number(valor('--futuros', 0));
const ventana = config.catalogos.diasSinRepetir;
const modo = valor('--modo', 'normal');

const db = await abrirBD(config.rutaBD);
const reserva = cargarReserva(config.rutaReserva, { dominios: config.fuentes.dominios });
const reservas = { normal: reserva };
for (const [modo, ruta] of Object.entries(config.rutasReserva)) reservas[modo] = cargarReserva(ruta, { dominios: config.fuentes.dominios, modo });
const publicar = (fecha, generador) => asegurarDesafio({ db, config, fecha, modo, reserva, reservas, generador });

// Historial inicial: días previos «manuales» (desde la reserva, sin firma de generador) y días futuros ya
// programados (también desde la reserva) dentro de la simulación.
const historialInicial = [];
for (let i = manuales; i >= 1; i--) {
  const fecha = sumarDias(inicio, -i);
  await publicar(fecha, 'reserva');
  historialInicial.push({ fecha, tipo: 'manual previo (reserva)' });
}
const programados = new Set();
for (let i = 1; i <= futuros; i++) {
  const fecha = sumarDias(inicio, Math.round((i * dias) / (futuros + 1)));
  await publicar(fecha, 'reserva');
  programados.add(fecha);
  historialInicial.push({ fecha, tipo: 'futuro ya programado (reserva)' });
}

const t0 = Date.now();
const resultados = [];
for (let i = 0; i < dias; i++) {
  const fecha = sumarDias(inicio, i);
  const r = await publicar(fecha, 'catalogos');
  resultados.push({ fecha, resultado: r.resultado, origen: r.origen ?? null, programado: programados.has(fecha) });
}
const ms = Date.now() - t0;

// ───── Métricas ─────
const preguntas = await db.all(
  `SELECT d.fecha, p.categoria, p.origen, p.firma, p.conjunto, p.generacion FROM preguntas p JOIN desafios d ON d.id = p.desafio_id
   WHERE d.modo = ? AND d.fecha BETWEEN ? AND ? ORDER BY d.fecha, p.posicion`,
  modo,
  inicio, sumarDias(inicio, dias - 1),
);
const generadas = preguntas.filter((p) => p.origen === 'catalogo').map((p) => ({ ...p, g: JSON.parse(p.generacion) }));
const contar = (lista, clave) => Object.fromEntries([...lista.reduce((m, x) => m.set(clave(x), (m.get(clave(x)) ?? 0) + 1), new Map())].sort((a, b) => b[1] - a[1]));
// Repeticiones: misma firma o mismo conjunto en dos fechas; la distancia mínima tiene que ser ≥ ventana.
let menorDistancia = Infinity;
let violaciones = 0;
let reutilizadas = 0;
for (const clave of ['firma', 'conjunto']) {
  const porClave = new Map();
  for (const p of generadas) porClave.set(p[clave], [...(porClave.get(p[clave]) ?? []), p.fecha]);
  for (const fechas of porClave.values()) {
    for (let i = 1; i < fechas.length; i++) {
      const d = diasEntre(fechas[i - 1], fechas[i]);
      menorDistancia = Math.min(menorDistancia, d);
      if (d < ventana) violaciones++;
      else if (clave === 'firma') reutilizadas++;
    }
  }
}
let topesViolados = 0;
const porDia = new Map();
for (const p of generadas) (porDia.get(p.fecha) ?? porDia.set(p.fecha, []).get(p.fecha)).push(p);
for (const ps of porDia.values()) {
  const categorias = contar(ps, p => p.categoria), universos = contar(ps, p => p.g.universo ?? p.g.catalogo.id), familias = contar(ps, p => p.g.familia);
  if (Object.entries(categorias).some(([c,n]) => n > (modo === 'geografia' ? 7 : c === 'gramatica' ? 1 : 2)) || Object.values(universos).some(n => n > (modo === 'geografia' ? 3 : 2)) || Object.values(familias).some(n => n > 1)) topesViolados++;
}
let otrosUniversosRepetidos = 0;
for (let i = 0; i < generadas.length; i++) for (let j = i - 1; j >= 0; j--) {
  const a = generadas[i], b = generadas[j];
  if (diasEntre(b.fecha, a.fecha) >= ventana) break;
  if ((a.g.universo ?? a.g.catalogo.id) !== (b.g.universo ?? b.g.catalogo.id) && (a.g.nombresConjunto && b.g.nombresConjunto ? Math.min(a.g.nombresConjunto.length,b.g.nombresConjunto.length)/Math.max(a.g.nombresConjunto.length,b.g.nombresConjunto.length) >= POR_OMISION.solapamientoOtroUniverso && jaccard(a.g.nombresConjunto,b.g.nombresConjunto) >= POR_OMISION.solapamientoOtroUniverso : jaccardEstimado(a.g.minhashNombres,b.g.minhashNombres) >= POR_OMISION.solapamientoOtroUniverso)) otrosUniversosRepetidos++;
}
const intervalosPorCategoria = Object.fromEntries([...new Set(generadas.map(p=>p.categoria))].map(c => {
  const fechas = [...new Set(generadas.filter(p=>p.categoria===c).map(p=>p.fecha))];
  const distancias = fechas.slice(1).map((f,i)=>diasEntre(fechas[i],f));
  return [CATEGORIAS[c] ?? c, { diasConPreguntas: fechas.length, intervaloMedio: distancias.length ? Math.round(distancias.reduce((s,n)=>s+n,0)/distancias.length*10)/10 : null, intervaloMaximo: distancias.length ? Math.max(...distancias) : null, diasHastaPrimera: diasEntre(inicio, fechas[0]), diasDesdeUltima: diasEntre(fechas.at(-1), sumarDias(inicio,dias-1)) }];
}));
const generados = resultados.filter((r) => !r.programado);
const informe = {
  configuracion: { modo, inicio, dias, ventana, diasRotacion: config.catalogos.diasRotacion, pesoRotacion: config.catalogos.pesoRotacion, semilla: config.catalogos.semilla, maxRespuestas: config.catalogos.maxRespuestas, completarConReserva: config.catalogos.completarConReserva },
  versiones: generadas[0]?.g.versiones ?? null,
  historialInicial,
  dias: {
    publicadosSoloCatalogos: generados.filter((r) => r.origen === 'catalogo').length,
    mixtos: generados.filter((r) => r.origen === 'mixto').length,
    soloReserva: generados.filter((r) => r.origen === 'reserva').length,
    fallos: generados.filter((r) => r.resultado === 'fallo').length,
    programadosDeAntes: resultados.filter((r) => r.programado).length,
    diasConReserva: generados.filter((r) => r.origen !== 'catalogo').map((r) => r.fecha),
  },
  preguntas: { generadas: generadas.length, deReserva: preguntas.length - generadas.length, consignasDistintas: new Set(generadas.map((p) => p.firma)).size },
  topesViolados, intervalosPorCategoria,
  repeticiones: { otrosUniversosRepetidos, violacionesDentroDeLaVentana: violaciones, consignasReutilizadasDespuesDeLaVentana: reutilizadas, menorDistanciaEntreRepeticiones: Number.isFinite(menorDistancia) ? menorDistancia : null },
  variedad: {
    porCategoria: contar(generadas, (p) => CATEGORIAS[p.categoria] ?? p.categoria),
    porCatalogo: contar(generadas, (p) => p.g.catalogo.id),
    porFamilia: contar(generadas, (p) => p.g.familia),
    porDificultad: contar(generadas, (p) => p.g.dificultad.nivel),
    // Cuántas preguntas por día tienen una condición sobre las letras del nombre (empieza, termina, tiene…).
    deLetrasPorDia: contar(Object.values(generadas.reduce((m, p) => ({ ...m, [p.fecha]: (m[p.fecha] ?? 0) + Number(p.g.filtro.y.some((c) => c.campo === 'nombre')) }), {})), (n) => `${n} de letras`),
    categoriasPorDia: contar(Object.values(generadas.reduce((m, p) => ({ ...m, [p.fecha]: new Set([...(m[p.fecha] ?? []), p.categoria]) }), {})), (s) => `${s.size} categorías`),
  },
  segundos: Math.round(ms / 100) / 10,
};
db.close();
rmSync(dir, { recursive: true, force: true });

if (valor('--json')) writeFileSync(valor('--json'), JSON.stringify(informe, null, 2));
const d = informe.dias;
console.log(`Simulación ${modo}: ${dias} días desde ${inicio} · ventana ${ventana} · semilla «${informe.configuracion.semilla}» · ${informe.segundos} s`);
if (historialInicial.length) console.log(`Historial inicial: ${historialInicial.map((h) => `${h.fecha} ${h.tipo}`).join(' · ')}`);
console.log(`Días: ${d.publicadosSoloCatalogos} solo con catálogos · ${d.mixtos} mixtos (completados con la reserva) · ${d.soloReserva} solo reserva · ${d.fallos} fallos · ${d.programadosDeAntes} ya programados`);
if (d.diasConReserva.length) console.log(`  usaron la reserva: ${d.diasConReserva.join(', ')}`);
console.log(`Preguntas generadas: ${informe.preguntas.generadas} (${informe.preguntas.consignasDistintas} consignas distintas) · de la reserva: ${informe.preguntas.deReserva}`);
console.log(`Repeticiones: ${informe.repeticiones.violacionesDentroDeLaVentana} dentro de la ventana · ${informe.repeticiones.consignasReutilizadasDespuesDeLaVentana} reutilizadas después · menor distancia ${informe.repeticiones.menorDistanciaEntreRepeticiones ?? '—'} días`);
for (const [titulo, m] of Object.entries(informe.variedad)) console.log(`${titulo}: ${Object.entries(m).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
process.exit(informe.repeticiones.violacionesDentroDeLaVentana || otrosUniversosRepetidos || topesViolados || d.fallos ? 1 : 0);
