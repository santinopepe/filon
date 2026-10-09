// Publicación y juego reales en una base aislada, con las cuatro categorías nuevas.
import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { iniciarServidor } from '../../servidor/index.js';
import { asegurarDesafio } from '../../servidor/generador/generar.js';
import { fechaLocal } from '../../servidor/tiempo.js';
import { CATEGORIAS } from '../../servidor/dominio.js';
import { BEARER, TOKEN_ADMIN_E2E, vigilarErrores } from './ayuda.js';

test('catálogos nuevos: publicar, jugar, mostrar alcance, revelar y ver estadísticas sin red externa', async ({ page }) => {
 const nuevas=['arte','television','naturaleza','gastronomia'];
 const dir=mkdtempSync(join(tmpdir(),'filon-e2e-catalogos-'));
 const pl=JSON.parse(readFileSync(new URL('../../datos/plantillas.json',import.meta.url),'utf8'));
 pl.plantillas=pl.plantillas.filter(p=>nuevas.includes(p.categoria));
 const ruta=join(dir,'plantillas.json');writeFileSync(ruta,JSON.stringify(pl));
 const app=await iniciarServidor({sinArchivoEnv:true,env:{PUERTO:'0',HOST:'127.0.0.1',RUTA_BD:join(dir,'juego.db'),BD_URL:'',TURSO_DATABASE_URL:'',TOKEN_ADMIN:TOKEN_ADMIN_E2E,PROGRAMADOR_INTERNO:'0',GENERADOR_NORMAL:'catalogos',CATALOGOS_COMPLETAR_CON_RESERVA:'0',CATALOGOS_PLANTILLAS:ruta,CATALOGOS_SEMILLA:'e2e-expansion',LIMITES_ESCALA:'50'}});
 try {
  const fecha=fechaLocal(Date.now(),app.config.zona);
  const pub=await asegurarDesafio({db:app.db,config:app.config,fecha,modo:'normal',generador:'catalogos',reserva:{preguntas:[]}});
  expect(pub.origen).toBe('catalogo');
  const base=`http://127.0.0.1:${app.puerto}`;
  const banco=await (await page.request.get(`${base}/api/admin/desafios/${fecha}`,{headers:BEARER})).json();
  expect(new Set(banco.preguntas.map(p=>p.categoria))).toEqual(new Set(nuevas));
  const errores=vigilarErrores(page),externas=[];
  page.on('request',r=>{if(new URL(r.url()).hostname!=='127.0.0.1')externas.push(r.url());});
  await page.goto(base);await page.click('#btn-comenzar');
  for(let n=0;n<7;n++) {
   const p=banco.preguntas[n];
   await expect(page.locator('#ronda-enunciado')).toHaveText(p.enunciado);
   await expect(page.locator('#ronda-alcance')).toHaveText(p.alcance);
   const correcta=p.respuestas[0].canonica;
   await page.fill('#campo-respuesta',correcta);await page.press('#campo-respuesta','Enter');
   await expect(page.locator('#p-resultado')).toBeVisible();await expect(page.locator('#res-respuesta')).toContainText(correcta);
   await page.locator('#btn-siguiente:not([disabled])').click();
  }
  await expect(page.locator('#p-final')).toBeVisible();await expect(page.locator('#desglose .respuesta-abrir')).toHaveCount(7);
  for(let n=0;n<7;n++) {
   await page.locator('#desglose .respuesta-abrir').nth(n).click();
   await expect(page.locator('#dlg-respuestas')).toBeVisible();
   await expect(page.locator('#lista-respuestas')).toContainText(banco.preguntas[n].respuestas[0].canonica);
   await page.keyboard.press('Escape');
  }
  const r=await page.request.get(`${base}/api/admin/estadisticas?desde=${fecha}&hasta=${fecha}&fecha=${fecha}`,{headers:BEARER});expect(r.ok()).toBe(true);
  const stats=JSON.stringify(await r.json());for(const c of nuevas)expect(stats).toContain(CATEGORIAS[c]);
  expect(errores).toEqual([]);expect(externas).toEqual([]);
 } finally {await app.cerrar();rmSync(dir,{recursive:true,force:true});}
});
