import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizar, crearIndice, buscarEnIndice, buscarParecidoEnIndice, formasRegistrables } from '../servidor/normalizar.js';

test('ignora mayúsculas, espacios repetidos y tildes', () => {
  assert.equal(normalizar('  ARGENTINA  '), 'argentina');
  assert.equal(normalizar('Perú'), 'peru');
  assert.equal(normalizar('Ramón    PUERTA'), 'ramon puerta');
  assert.equal(normalizar('Bélgica'), normalizar('belgica'));
  assert.equal(normalizar('Pingüino'), 'pinguino');
});

test('conserva la ñ: «año» no es «ano»', () => {
  assert.equal(normalizar('Año'), 'año');
  assert.notEqual(normalizar('año'), normalizar('ano'));
  assert.equal(normalizar('ESPAÑA'), 'españa');
  // ñ escrita en forma descompuesta (n + tilde combinable) también se conserva
  assert.equal(normalizar('España'), 'españa');
  assert.equal(normalizar('Iñárritu'), 'iñarritu');
});

test('quita puntuación y apóstrofos', () => {
  assert.equal(normalizar("Giovanna d'Arco"), 'giovanna darco');
  assert.equal(normalizar('Tlön, Uqbar, Orbis Tertius'), 'tlon uqbar orbis tertius');
  assert.equal(normalizar('St. Louis'), 'st louis');
  assert.equal(normalizar('Harry Potter and the Philosopher’s Stone'), 'harry potter and the philosophers stone');
});

test('registra formas sin artículo inicial', () => {
  assert.deepEqual(formasRegistrables('La traviata'), ['la traviata', 'traviata']);
  assert.deepEqual(formasRegistrables('Argentina'), ['argentina']);
});

test('busca por forma exacta, sin artículo y compacta', () => {
  const indice = crearIndice([
    { respuestaId: 1, normalizada: 'la traviata' },
    { respuestaId: 1, normalizada: 'traviata' },
    { respuestaId: 2, normalizada: 'j r r tolkien' },
    { respuestaId: 3, normalizada: 'argentina' },
  ]);
  assert.equal(buscarEnIndice(indice, 'LA TRAVIATA'), 1);
  assert.equal(buscarEnIndice(indice, 'traviata'), 1);
  assert.equal(buscarEnIndice(indice, 'jrr tolkien'), 2);
  assert.equal(buscarEnIndice(indice, 'J.R.R. Tolkien'), 2);
  assert.equal(buscarEnIndice(indice, 'la Argentina'), 3);
  assert.equal(buscarEnIndice(indice, 'Argentin'), null);
  assert.equal(buscarEnIndice(indice, '   '), null);
});

test('una forma compacta ambigua no acepta ninguna respuesta', () => {
  const indice = crearIndice([
    { respuestaId: 1, normalizada: 'san ta' },
    { respuestaId: 2, normalizada: 'santa' },
  ]);
  assert.equal(buscarEnIndice(indice, 'santa'), 2); // la exacta gana
  assert.equal(buscarEnIndice(indice, 's anta'), null); // compacta ambigua
});

test('completa errores de tipeo inequívocos sin revelar prefijos cortos', () => {
  const indice = crearIndice([
    { respuestaId: 1, normalizada: 'argentina' },
    { respuestaId: 2, normalizada: 'argelia' },
    { respuestaId: 3, normalizada: 'harry potter' },
  ]);
  assert.equal(buscarParecidoEnIndice(indice, 'argnetina'), 1, 'tolera letras intercambiadas');
  assert.equal(buscarParecidoEnIndice(indice, 'hary poter'), 3, 'tolera más errores en nombres largos');
  assert.equal(buscarParecidoEnIndice(indice, 'arge'), null, 'no completa fragmentos cortos');
  assert.equal(buscarParecidoEnIndice(indice, 'algo totalmente distinto'), null);
});

test('reconoce las mismas palabras en otro orden y agrupa iniciales', () => {
  const indice = crearIndice([
    { respuestaId: 1, normalizada: 'j r r tolkien' },
    { respuestaId: 2, normalizada: 'gabriel garcia marquez' },
  ]);
  assert.equal(buscarEnIndice(indice, 'Tolkien JRR'), 1);
  assert.equal(buscarEnIndice(indice, 'Márquez Gabriel García'), 2);
});

test('no completa una coincidencia difusa ambigua', () => {
  const indice = crearIndice([
    { respuestaId: 1, normalizada: 'maria' },
    { respuestaId: 2, normalizada: 'marina' },
  ]);
  assert.equal(buscarParecidoEnIndice(indice, 'mariaa'), null);
});
