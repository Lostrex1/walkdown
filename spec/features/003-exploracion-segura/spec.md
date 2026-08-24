# 003 · Exploración segura y grafo de la aplicación

**Estado:** implementado

## Qué hace

Walkdown descubre de forma acotada las rutas internas y los elementos interactivos de una aplicación pública. Construye un grafo página → elemento → acción → estado, pero solo ejecuta acciones clasificadas como seguras.

El usuario controla páginas, profundidad, acciones, tiempo, origen permitido e includes/excludes. El resultado explica qué se exploró, qué se omitió y por qué.

## Por qué

Probar comportamiento sin tests escritos exige descubrir superficie real, pero un crawler que hace clic indiscriminadamente puede borrar datos, comprar o generar efectos externos. La política de seguridad es una capacidad central, no un añadido posterior.

## Criterios de aceptación

- [x] Descubre enlaces internos navegables desde el target hasta `maxPages`, `maxDepth` o timeout global.
- [x] Normaliza URLs, elimina fragments para identidad y aplica una política documentada a query params.
- [x] Respeta mismo origen, includes, excludes y navegación externa desactivada por defecto.
- [x] Inventaría links, buttons, inputs, selects, textareas, roles interactivos y elementos con indicios visuales de click.
- [x] Cada elemento tiene `ElementRef` portable con rol/nombre accesible/contexto, sin depender solo de CSS.
- [x] Clasifica acciones como `safe`, `reversible`, `side-effect`, `destructive`, `external` o `unknown` con razón auditable.
- [x] Solo ejecuta navegación GET y otras acciones `safe` en el modo predeterminado.
- [x] Textos/atributos relacionados con delete, pay, buy, send, publish, invite, logout y equivalentes se omiten conservadoramente.
- [x] Formularios, uploads, descargas y controles desconocidos no se activan por defecto.
- [x] El reporte incluye cobertura, rutas pendientes y acciones omitidas; alcanzar un presupuesto no se presenta como scan completo.
- [x] Loops, calendarios, paginaciones infinitas y URLs generadas no desbordan el presupuesto.
- [x] El crawler produce el mismo orden lógico con el mismo fixture y configuración.

## Fuera de alcance

- Autenticación y journeys declarados.
- Envío automático de formularios.
- Interpretación semántica mediante LLM.
- Crawling de otros dominios o APIs.
