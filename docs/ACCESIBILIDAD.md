# Filón para jugadores casuales

## Diagnóstico y cambios aplicados

La dificultad venía de tres fuentes distintas. El percentil de popularidad **dentro de cada catálogo** daba una buena nota incluso a temas que un jugador casual no conoce. Las metas de dificultad eran preferencias: rotación y prioridad podían superarlas, y después se mezclaba el orden. Los cruces de letras, regiones, años y clasificaciones añadían esfuerzo de recuerdo. La simplificación se aplica al armado del desafío y conserva el juego original.

La validación escrita ya normaliza tildes, mayúsculas, separadores y alias; conserva la ñ, resuelve colisiones y propone fragmentos inequívocos para confirmar. No se amplió a coincidencias ambiguas ni se cambiaron los filtros factuales. Las palabras de Gramática siguen exigiendo la palabra entera. Una forma alternativa de la misma respuesta cuenta una vez, incluso ante envíos concurrentes.

Los tiempos, el cierre y avance de rondas, los puntos, las rarezas, las recompensas y las estadísticas conservan su implementación original. El armado selecciona preguntas más sencillas. La ronda muestra la consigna sin la descripción adicional y el modal de respuestas bloquea el scroll del fondo, conservando el desplazamiento de su lista. Una pregunta accesible también admite oro y diamante; su dificultad no se confunde con la rareza de las respuestas.

## Selección y familiaridad editorial

`datos/familiaridad.json` etiqueta nombres y alias existentes que estimamos familiares para un público casual de Argentina. Es una **hipótesis editorial**, no conocimiento medido en jugadores. No agrega hechos, respuestas ni sinónimos al banco. Su versión y checksum se guardan en los metadatos del desafío para reproducir la selección. Las vistas usan las etiquetas de su catálogo base.

Una pregunta fácil requiere al menos tres referencias familiares (`CATALOGOS_MIN_FAMILIARES`, entre 3 y 5) y una relación simple o una sola condición sobre el nombre. Varias letras obligatorias cuentan como varias condiciones. Se excluyen de fáciles los períodos, años en el valor, clasificaciones técnicas y el recuerdo de títulos de álbumes. El percentil sigue siendo una señal secundaria, junto con la plantilla, el tema y el tamaño del conjunto. Una lista grande por sí sola no vuelve fácil a una consigna.

Los alias familiares solo cuentan si esa forma también satisface la condición sobre el nombre. Ejemplo: conocer «oso polar» no vuelve fácil una consigna que exige empezar con U y cuya respuesta canónica es *Ursus maritimus*. Se conservan **todas** las respuestas correctas del conjunto; las etiquetas nunca lo recortan.

Se agregaron condiciones únicas sobre nombres (incluidas frutas/hortalizas y comidas, sin exigir clasificaciones técnicas) y cinco vistas cerradas: estados estadounidenses y brasileños, provincias españolas, partidos bonaerenses y ciudades argentinas de 100.000 habitantes o más según GeoNames. Las vistas no copian datos, mantienen el universo, las fuentes, la cobertura y las firmas semánticas de sus bases. Las plantillas compuestas siguen disponibles para niveles superiores. Si dos redacciones dan el mismo conjunto, el perfil casual conserva la formulación accesible.

El perfil `casual` exige cinco fáciles y dos intermedias, en este orden inicial de prueba: **fácil, fácil, intermedia, fácil, fácil, intermedia, fácil**. Mantiene cuatro categorías como mínimo en Normal, los topes de categoría/universo/familia, la rotación y los 60 días de no repetición (también compara días futuros programados). Geografía mantiene su máximo de cinco consignas de letras. La búsqueda puede retroceder dentro de un presupuesto acotado si una elección impide completar el reparto. Si no puede cumplirlo, no publica un lote parcial ni completa con preguntas de reserva sin clasificación compatible. `CATALOGOS_PERFIL=clasico` permite el reparto flexible y el respaldo de reserva anterior.

## Ejemplos y comprobación

Ejemplos ilustrativos del cambio de complejidad:

- Antes: «Nombrá un país sin costa que contenga B y A». Después: «Nombrá un país cuyo nombre termine en A»: Argentina, Bolivia, Francia, Italia y España, además de todas las demás respuestas del filtro.
- Antes: una película nominada en una ceremonia específica. Después: una película de Harry Potter; el catálogo existente tiene la saga verificada completa. **Pixar no se incorporó como consigna:** el catálogo actual no declara completa esa relación.
- Antes: una clasificación técnica de instrumentos. Después: un instrumento cuyo nombre tenga una letra; las respuestas familiares y las especializadas correctas conviven.

Para inspeccionar candidatos reales, ejecutar `node scripts/vista-previa-catalogos.mjs casual-paises` o la vista previa del panel. Para comprobar un calendario sin tocar producción: `npm run simular-calendario -- --dias 180 --inicio 2026-11-01 --json /tmp/casual-normal.json`, y lo mismo con `--modo geografia`. El informe comprueba el reparto, las primeras dos, respuestas familiares, variedad y no repetición. Las pruebas nuevas cubren familiaridad editorial, filtros simples y compuestos, clasificación, determinismo, variedad y conservación del conjunto completo de respuestas. Las pruebas existentes conservan el contrato del juego original.

La familiaridad estimada y la mejora real de la accesibilidad necesitan validación con jugadores. También conviene observar si las negaciones sobre nombres se entienden rápidamente. La configuración actúa al generar días nuevos; los días ya publicados no se reescriben.

### Vista previa comparativa real (no publicada)

Se usaron fecha `2026-11-01`, semilla base `comparacion-casual` e historial vacío. Las versiones del generador y de sus datos cambian la semilla derivada, por lo que son muestras representativas, no pares idénticos ni resultados de jugadores.

Antes (v3):

- Nombrá a alguien que haya integrado U2 en algún momento. — media.
- Nombrá un libro de J. R. R. Tolkien. — facil.
- Nombrá una fruta, hortaliza o legumbre de la categoría «frutas de pepita» del CAA. — media.
- Nombrá un club que haya ganado la Copa de Europa o la Champions League entre 1996 y 2015. — media.
- Nombrá un álbum de estudio de Bad Bunny. — media.
- Nombrá un Pokémon de tipo Agua. — facil.
- Nombrá una película dirigida por Quentin Tarantino. — facil.

Después (v4, cinco fáciles y dos intermedias):

- Nombrá la capital de un país de Europa. — facil, 17 respuestas familiares estimadas; 44 respuestas correctas completas.
- Nombrá una capital provincial argentina cuyo nombre no tenga la «S». — facil, 7 respuestas familiares estimadas; 7 respuestas correctas completas.
- Nombrá un instrumento musical de la familia de los cordófonos. — media, 9 respuestas familiares estimadas; 127 respuestas correctas completas.
- Nombrá un elemento químico cuyo nombre contenga «it». — facil, 3 respuestas familiares estimadas; 6 respuestas correctas completas.
- Nombrá a alguien que haya integrado The Beatles en algún momento. — facil, 4 respuestas familiares estimadas; 9 respuestas correctas completas.
- Nombrá un club campeón de la Champions entre 1990 y 1999. — media, 6 respuestas familiares estimadas; 9 respuestas correctas completas.
- Nombrá una película dirigida por Francis Ford Coppola. — facil, 3 respuestas familiares estimadas; 33 respuestas correctas completas.

La simulación SQLite de Normal verificó 180 días: 1.260 preguntas, 900 fáciles y 360 intermedias, cero fallos, cero respaldo de reserva y cero repeticiones dentro de 60 días. Informe reproducible en [casual-normal-180.json](informes/casual-normal-180.json).

Geografía también completó 180 días en dos semillas, con 900 fáciles y 360 intermedias por simulación, cero fallos, cero violaciones de topes y cero repeticiones dentro de la ventana. Informes: [semilla simulacion](informes/casual-geografia-180.json) y [segunda semilla](informes/casual-geografia-otra-180.json).

La selección más sencilla se verifica con las pruebas del generador y los informes de calendario. Las pruebas del modal comprueban que el fondo queda bloqueado, la lista se puede recorrer y el scroll vuelve al cerrar, en escritorio y móvil. No se agregan ayudas, cambios de dinámica ni métricas al juego.
