# Capacidad y verificación de la ampliación de Filón

Informe de cierre del 2026-10-08, con Node **24.19.0**, plantillas **5**, generador **3**, filtros **1** y los catálogos versionados del repositorio. Normal y Geografía usan exactamente el mismo inventario de versiones; el detalle está en los JSON enlazados. El informe se generó antes de publicar los cambios; las pruebas usan bases aisladas y no alteran preguntas o partidas existentes.

**Resultado:** Normal cuenta con **4.765** consignas utilizables y Geografía con **1.160**. Ambos publicaron **180/180 días y 1.260 preguntas**, sin reserva, fallos, violaciones de topes ni repeticiones a menos de 60 días. La distancia mínima de reutilización fue **60 días**.

## Capacidad real por categoría

Los registros son la unión por `universo:id` de los catálogos/vistas conectados mediante plantillas a esa categoría. Las vistas no suman dos veces sus entidades. Una misma persona presente en universos distintos cuenta como registros distintos; estos números no son un censo global de personas. En Música se cuentan los tipos de álbum con plantillas: el base contiene más registros de otros tipos, detallados abajo.

Las consignas pasan cobertura, mínimo de cinco respuestas, nombres no ambiguos y validación de pregunta. Se deduplican conjuntos del mismo universo. El conteo estático todavía puede incluir conjuntos parecidos de universos diferentes: su bloqueo temporal se comprueba en la simulación.

| Categoría | Registros conectados | Consignas utilizables | Preguntas en Normal (180 días) |
| --- | ---: | ---: | ---: |
| Gramática | 47.611 | 2.473 | 64 |
| Geografía | 2.429 | 1.153 | 155 |
| Música | 7.993 | 336 | 117 |
| Videojuegos | 1.085 | 262 | 108 |
| Informática | 1.268 | 128 | 118 |
| Cine | 532 | 75 | 87 |
| Ciencia | 782 | 68 | 119 |
| Historia | 370 | 54 | 69 |
| Gastronomía | 334 | 52 | 71 |
| Deportes | 267 | 49 | 79 |
| Arte | 330 | 37 | 71 |
| Literatura | 692 | 32 | 64 |
| Televisión | 93 | 14 | 42 |
| Astronomía | 101 | 13 | 39 |
| Idiomas | 300 | 12 | 36 |
| Naturaleza | 151 | 7 | 21 |

Geografía tiene 2.429 registros conectados en ambos modos. Sus 1.160 consignas del modo dedicado incluyen siete alternativas de idiomas que no se asignan a Geografía en el total deduplicado de Normal.

## ¿Alcanza para 60 × 7 = 420?

| Modo | Consignas | Sin Gramática | Cota estática con topes | Necesarias | Resultado del calendario |
| --- | ---: | ---: | ---: | ---: | --- |
| normal | 4.765 | 2.292 | 946 | 420 | 180 días completos sin reserva |
| geografia | 1.160 | 1.160 | 420 | 420 | 180 días completos sin reserva |

El cálculo de flujo combina categoría (Normal: máximo dos por día, Gramática uno), universo (Normal: dos; Geografía: tres), conjunto (una vez por ventana) y familia (una por día). Normal asigna conservadoramente cada universo a una categoría y omite siete alternativas. La cota no garantiza por sí sola el reparto diario, la rotación ni el bloqueo por nombres entre universos. La evidencia de suficiencia es el calendario publicado en una base temporal: 180 días con al menos cuatro categorías por día en Normal y sin violaciones de topes. No garantiza cualquier historial manual o semilla futura.

## Capacidad por catálogo

Las consignas propias de una vista se informan para poder inspeccionarla; no se suman nuevamente al total de su universo. «Por vistas» muestra las consignas de vistas conectadas al base, también sin sumarlas a las propias. `albumes` no tiene una plantilla directa: se usa mediante las vistas de estudio y en vivo.

| Catálogo | Registros | Consignas propias | Por vistas | Universo / vista |
| --- | ---: | ---: | ---: | --- |
| `albumes` | 9.683 | 0 | 168 | `albumes` |
| `albumes_en_vivo` | 2.793 | 56 | 0 | vista de `albumes` |
| `albumes_estudio` | 1.728 | 112 | 0 | vista de `albumes` |
| `animales` | 151 | 7 | 0 | `animales` |
| `artistas_musicales` | 2.332 | 71 | 8 | `artistas_musicales` |
| `autores` | 170 | 2 | 0 | `autores` |
| `bandas_argentinas` | 165 | 8 | 0 | vista de `artistas_musicales` |
| `campeones_champions` | 24 | 8 | 0 | `campeones_champions` |
| `campeones_f1` | 35 | 5 | 0 | `campeones_f1` |
| `campeones_mundial` | 8 | 1 | 0 | `campeones_mundial` |
| `canciones` | 781 | 67 | 0 | `canciones` |
| `capitales` | 202 | 283 | 0 | `capitales` |
| `capitales_argentinas` | 23 | 2 | 0 | `capitales_argentinas` |
| `capitales_subdivisiones` | 251 | 19 | 0 | `capitales_subdivisiones` |
| `cientificos` | 664 | 31 | 0 | `cientificos` |
| `ciudades` | 597 | 57 | 0 | `ciudades` |
| `clubes_futbol` | 61 | 19 | 0 | `clubes_futbol` |
| `codigos_http` | 60 | 4 | 0 | `codigos_http` |
| `comidas` | 159 | 23 | 0 | `comidas` |
| `componentes_pc` | 18 | 1 | 0 | `componentes_pc` |
| `conectores` | 14 | 3 | 0 | `conectores` |
| `constelaciones` | 88 | 11 | 0 | `constelaciones` |
| `departamentos_argentinos` | 514 | 217 | 0 | `departamentos_argentinos` |
| `deportistas` | 115 | 9 | 0 | `deportistas` |
| `elementos` | 118 | 37 | 0 | `elementos` |
| `elementos_html` | 113 | 11 | 0 | `elementos_html` |
| `formatos_archivo` | 163 | 3 | 0 | `formatos_archivo` |
| `frutas_verduras` | 175 | 29 | 0 | `frutas_verduras` |
| `idiomas` | 105 | 5 | 0 | `idiomas` |
| `instrumentos_musicales` | 359 | 22 | 0 | `instrumentos_musicales` |
| `lenguajes_programacion` | 217 | 43 | 0 | `lenguajes_programacion` |
| `libros` | 340 | 13 | 0 | `libros` |
| `monedas` | 143 | 5 | 0 | `monedas` |
| `mundial_femenino` | 5 | 1 | 0 | `mundial_femenino` |
| `nobel_literatura` | 122 | 13 | 0 | `nobel_literatura` |
| `obras_arte` | 330 | 37 | 0 | `obras_arte` |
| `oscar_pelicula` | 98 | 20 | 0 | `oscar_pelicula` |
| `paises` | 195 | 265 | 0 | `paises` |
| `palabras` | 47.611 | 2.473 | 0 | `palabras` |
| `papas` | 265 | 35 | 0 | `papas` |
| `parques_nacionales_argentinos` | 39 | 13 | 0 | `parques_nacionales_argentinos` |
| `peliculas` | 434 | 52 | 4 | `peliculas` |
| `peliculas_argentinas` | 28 | 4 | 0 | vista de `peliculas` |
| `perifericos` | 34 | 3 | 0 | `perifericos` |
| `personajes_ficcion` | 9 | 1 | 0 | `personajes_ficcion` |
| `pokemon` | 1.025 | 259 | 0 | `pokemon` |
| `premio_cervantes` | 51 | 3 | 0 | `premio_cervantes` |
| `presidentes_argentinos` | 51 | 14 | 0 | `presidentes_argentinos` |
| `presidentes_eeuu` | 45 | 4 | 0 | `presidentes_eeuu` |
| `propiedades_css` | 492 | 42 | 0 | `propiedades_css` |
| `provincias_argentinas` | 23 | 13 | 0 | `provincias_argentinas` |
| `secretarios_onu` | 9 | 1 | 0 | `secretarios_onu` |
| `sedes_mundial` | 19 | 6 | 0 | `sedes_mundial` |
| `series` | 93 | 14 | 0 | `series` |
| `sistema_solar` | 13 | 2 | 0 | `sistema_solar` |
| `sistemas_operativos` | 157 | 18 | 0 | `sistemas_operativos` |
| `subdivisiones` | 442 | 286 | 0 | `subdivisiones` |
| `videojuegos` | 60 | 3 | 0 | `videojuegos` |

En [capacidad-geografia.json](informes/capacidad-geografia.json) están los conteos por catálogo del modo Geografía; en [capacidad-normal.json](informes/capacidad-normal.json), el detalle de todas las plantillas, combinaciones y descartes. Ambos cargadores reportaron **cero problemas**.

## Simulaciones finales de 180 días

Período: **2026-10-09 a 2027-04-06**. Semilla `simulacion`, historial inicial vacío, ventana de 60 días, `diasRotacion=5`, `pesoRotacion=0.6`. Cada simulación usa una base nueva temporal y la publicación real mediante `asegurarDesafio`; no modifica el banco de producción.

| Métrica | Normal | Geografía |
| --- | ---: | ---: |
| Días completos solo con catálogos | 180 | 180 |
| Días mixtos | 0 | 0 |
| Fallos | 0 | 0 |
| Preguntas generadas | 1260 | 1260 |
| Preguntas de reserva | 0 | 0 |
| Consignas distintas usadas | 682 | 551 |
| Violaciones de topes | 0 | 0 |
| Repeticiones a menos de 60 días | 0 | 0 |
| Conjuntos casi iguales de otros universos dentro de ventana | 0 | 0 |
| Distancia mínima de reutilización (días) | 60 | 60 |
| Reutilizaciones permitidas desde 60 días | 578 | 709 |
| Tiempo de generación (segundos) | 359,2 | 75.2 |

### Distribución por dificultad

| Dificultad | Normal | Geografía |
| --- | ---: | ---: |
| facil | 398 | 126 |
| media | 606 | 682 |
| dificil | 256 | 452 |

Normal tuvo cuatro categorías en 9 días, cinco en 57, seis en 94 y siete en 20. En Geografía las 1.260 preguntas pertenecen a Geografía; hubo cero días con más de tres preguntas de letras.

### Rotación conseguida en Normal

Los intervalos miden días entre apariciones de la categoría, no entre preguntas individuales. Se muestran también los bordes del período para no ocultar huecos iniciales/finales.

| Categoría | Días con preguntas | Intervalo medio | Intervalo máximo | Hasta primera | Desde última |
| --- | ---: | ---: | ---: | ---: | ---: |
| Arte | 71 | 2,5 | 3 | 1 | 1 |
| Astronomía | 39 | 4,5 | 11 | 2 | 7 |
| Ciencia | 78 | 2,3 | 3 | 1 | 0 |
| Cine | 72 | 2,5 | 4 | 0 | 0 |
| Deportes | 79 | 2,3 | 3 | 1 | 0 |
| Gastronomía | 71 | 2,6 | 4 | 0 | 0 |
| Geografía | 91 | 2 | 3 | 0 | 0 |
| Gramática | 64 | 2,8 | 4 | 2 | 1 |
| Historia | 69 | 2,6 | 3 | 2 | 0 |
| Idiomas | 36 | 4,8 | 15 | 2 | 9 |
| Informática | 72 | 2,5 | 3 | 1 | 1 |
| Literatura | 64 | 2,8 | 4 | 0 | 1 |
| Música | 80 | 2,3 | 3 | 0 | 1 |
| Naturaleza | 21 | 8,2 | 18 | 2 | 13 |
| Televisión | 42 | 4,2 | 10 | 1 | 7 |
| Videojuegos | 76 | 2,4 | 4 | 0 | 1 |

Naturaleza tiene solo siete consignas: la ventana permite como máximo siete apariciones por cada 60 días si se distribuyen una por día. Alcanzó 21 apariciones en 180 días, intervalo medio 8,2 y máximo 18. La ampliación de grupos y el ajuste de rotación redujeron el máximo de 40 días observado antes del ajuste. Televisión pasó a 14 consignas y aparece cada 4,2 días en promedio, máximo 10. No se promete que las categorías pequeñas salgan cada cinco días: su oferta no lo permite.

## Verificación ejecutada

`npm run verificar` completo terminó con código 0 usando Node 24.19.0:

- ESLint y sintaxis: correctos; 107 archivos JS revisados, cero errores.
- Pruebas con cobertura: **154/154**, cero fallos. Líneas **95,93 %**, ramas **87,05 %**, funciones **94,55 %**; superan los umbrales 85/70/85.
- Reservas: válidas en los modos configurados.
- Auditoría de dependencias de producción: **0 vulnerabilidades**.
- Playwright/Chromium: **28/28**, incluido publicar → jugar siete rondas → mostrar alcance → revelar todas → estadísticas con Arte, Televisión, Naturaleza y Gastronomía; cero solicitudes externas del navegador durante la partida.
- Después del ajuste final del informe por catálogo se repitieron lint, sintaxis y ambas mediciones de capacidad; el generador y sus datos permanecieron idénticos.
- Fixture de firmas históricas, vistas compartidas, cobertura por valores, atributos múltiples, alias JPG/parlantes, límite 59/60 días, conjunto 99/100 de otro universo, rotación y recuperación del historial sin reescritura: todas pasan. También se verifican años Nobel relacionados, taxones únicos, tablas CAA y Balón de Oro.

El log completo está en [verificar-node24.txt](informes/verificar-node24.txt). Durante el trabajo las pruebas detectaron un falso negativo de MinHash, homónimos y un registro literario duplicado: se corrigieron y la corrida final no tiene fallos.

## Fuentes, actualización y pendientes

La tabla de fuentes/licencias, comandos de importación, reglas de cobertura y pendientes exactos están en [GENERADOR.md](GENERADOR.md). Permanecen sin catálogo terminado plantas y programas de TV argentinos; también quedan sin certificar los estudios/sagas y franquicias adicionales detallados allí. Los atributos incompletos no habilitan filtros globales. Los archivos existentes se conservaron y no se agregaron dependencias ni servicios pagos.

```sh
npm run capacidad-catalogos -- --json
npm run capacidad-catalogos -- --modo geografia --json
npm run simular-calendario -- --dias 180 --inicio 2026-10-09 --json /tmp/normal.json
npm run simular-calendario -- --modo geografia --dias 180 --inicio 2026-10-09 --json /tmp/geografia.json
npm run verificar
```

Informes completos: [Normal](informes/simulacion-normal-180.json), [Geografía](informes/simulacion-geografia-180.json). Las versiones exactas de todos los catálogos quedan registradas en ambos. Los tiempos se midieron durante ejecución concurrente y no son un benchmark aislado.
