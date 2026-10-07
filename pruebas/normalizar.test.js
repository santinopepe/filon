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

test('completa apellidos y palabras omitidas sin exigir variantes registradas', () => {
  const indice = crearIndice([
    { respuestaId: 1, normalizada: 'gabriel garcia marquez' },
    { respuestaId: 2, normalizada: 'j r r tolkien' },
    { respuestaId: 3, normalizada: 'johann sebastian bach' },
  ]);
  for (const texto of ['Márquez', 'García Márquez', 'Márquez García', 'Gabriel Márquez']) {
    assert.equal(buscarParecidoEnIndice(indice, texto), 1, texto);
  }
  assert.equal(buscarParecidoEnIndice(indice, 'Tolkien'), 2);
  assert.equal(buscarParecidoEnIndice(indice, 'Bach'), 3, 'una palabra completa de cuatro letras alcanza');
  assert.equal(buscarEnIndice(indice, 'Márquez'), null, 'un fragmento se sugiere, no se acepta como exacto');
});

test('completa subcadenas internas, prefijos y frases compactas suficientemente largas', () => {
  const indice = crearIndice([
    { respuestaId: 1, normalizada: 'gabriel garcia marquez' },
    { respuestaId: 2, normalizada: 'el señor de los anillos' },
  ]);
  for (const texto of ['marqu', 'arquez', 'garciamarq', 'riel garcia']) {
    assert.equal(buscarParecidoEnIndice(indice, texto), 1, texto);
  }
  assert.equal(buscarParecidoEnIndice(indice, 'señor de los'), 2);
  for (const texto of ['mar', 'marq', 'de los', 'los', 'el']) {
    assert.equal(buscarParecidoEnIndice(indice, texto), null, texto);
  }
});

test('corrige errores en un apellido o frase dentro de un nombre largo', () => {
  const indice = crearIndice([
    { respuestaId: 1, normalizada: 'gabriel garcia marquez' },
    { respuestaId: 2, normalizada: 'j r r tolkien' },
    { respuestaId: 3, normalizada: 'johann sebastian bach' },
    { respuestaId: 4, normalizada: 'harry potter y la piedra filosofal' },
  ]);
  for (const texto of ['marqez', 'garcia marqez', 'marqez garcia', 'garciamarqez']) {
    assert.equal(buscarParecidoEnIndice(indice, texto), 1, texto);
  }
  assert.equal(buscarParecidoEnIndice(indice, 'tolkein'), 2);
  assert.equal(buscarParecidoEnIndice(indice, 'bachh'), 3);
  assert.equal(buscarParecidoEnIndice(indice, 'hary poter'), 4, 'tolera dos omisiones dentro de un título largo');
  assert.equal(buscarParecidoEnIndice(indice, 'marxx'), null, 'demasiados errores en una entrada corta');
});

test('no desempata fragmentos compartidos por el largo del nombre o sus variantes', () => {
  const indice = crearIndice([
    { respuestaId: 1, normalizada: 'john smith' },
    { respuestaId: 1, normalizada: 'j smith' },
    { respuestaId: 2, normalizada: 'maggie smith' },
    { respuestaId: 3, normalizada: 'gabriel garcia marquez' },
    { respuestaId: 4, normalizada: 'gabriela mistral' },
  ]);
  for (const texto of ['Smith', 'smiht', 'Gabriel', 'gabri']) {
    assert.equal(buscarParecidoEnIndice(indice, texto), null, texto);
  }
  assert.equal(buscarParecidoEnIndice(indice, 'John Smith'), 1);
  assert.equal(buscarParecidoEnIndice(indice, 'Maggie'), 2);
});

test('las formas exactas y variantes tienen prioridad sobre coincidencias parciales', () => {
  const indice = crearIndice([
    { respuestaId: 1, normalizada: 'austria' },
    { respuestaId: 2, normalizada: 'australia' },
    { respuestaId: 3, normalizada: 'johann strauss' },
    { respuestaId: 3, normalizada: 'strauss' },
    { respuestaId: 4, normalizada: 'richard strauss' },
  ]);
  assert.equal(buscarParecidoEnIndice(indice, 'Austria'), 1);
  assert.equal(buscarParecidoEnIndice(indice, 'Strauss'), 3);
  assert.equal(buscarParecidoEnIndice(indice, 'straus'), null);
});

test('no completa números solos ni reutiliza una palabra para cubrir dos', () => {
  const indice = crearIndice([{ respuestaId: 1, normalizada: 'maria antonieta 19842' }]);
  assert.equal(buscarParecidoEnIndice(indice, '19842'), null);
  assert.equal(buscarParecidoEnIndice(indice, 'Maria Maria'), null);
  assert.equal(buscarParecidoEnIndice(indice, '   !!!'), null);
});

test('variantes y filas duplicadas de una misma respuesta no crean ambigüedad', () => {
  const indice = crearIndice([
    { respuestaId: 1, normalizada: 'gabriel garcia marquez' },
    { respuestaId: 1, normalizada: 'garcia marquez' },
    { respuestaId: 1, normalizada: 'garcia marquez' },
    { respuestaId: 1, normalizada: '' },
  ]);
  assert.equal(buscarParecidoEnIndice(indice, 'Marquez'), 1);
  assert.equal(buscarParecidoEnIndice(indice, 'marqez'), 1);
});
