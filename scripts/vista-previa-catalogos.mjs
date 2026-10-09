// Revisión editorial de candidatos reales; ningún conjunto se trunca al generar.
import { cargarConfig } from '../servidor/config.js';
import { cargarCatalogos } from '../servidor/catalogos/catalogos.js';
import { cargarPlantillas } from '../servidor/catalogos/plantillas.js';
import { prepararCandidatos } from '../servidor/catalogos/generador.js';
const config = cargarConfig({ sinArchivoEnv: true, env: {} });
const { catalogos, problemas } = cargarCatalogos(config.catalogos.dir);
const pl = cargarPlantillas(config.catalogos.rutaPlantillas);
if (problemas.length || pl.problemas.length) console.error([...problemas, ...pl.problemas]);
for (const p of pl.plantillas.filter(p => p.id.startsWith(process.argv[2] ?? ''))) {
  const cat = catalogos.get(p.catalogo);
  if (!cat) { console.error(`${p.id}: falta ${p.catalogo}`); continue; }
  const r = prepararCandidatos(p, cat, { validar: true, completo: true, dominios: config.fuentes.dominios });
  console.log(JSON.stringify({ plantilla: p.id, validas: r.candidatos.length, descartes: r.descartes }));
  for (const c of r.candidatos) {
    const orden = [...c.entidades].sort((a,b) => b.popularidad-a.popularidad || a.nombre.localeCompare(b.nombre,'es'));
    console.log(JSON.stringify({ enunciado: c.enunciado, respuestas: orden.length, dificultad: c.dificultad, conocidas: orden.slice(0,5).map(e=>e.nombre), menosConocidas: orden.slice(-5).map(e=>e.nombre) }));
  }
}
