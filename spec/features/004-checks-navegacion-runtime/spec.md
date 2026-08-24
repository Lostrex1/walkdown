# 004 · Checks de navegación y runtime

**Estado:** implementado

## Qué hace

Interpreta observaciones pasivas del scan para detectar defectos de alta confianza: enlaces internos rotos, destinos vacíos/placeholder, redirecciones problemáticas, excepciones JavaScript, errores relevantes de consola y requests first-party fallidas.

## Por qué

Estos fallos son frecuentes, tienen evidencia objetiva y no requieren interacciones arriesgadas. Constituyen el primer conjunto útil de reglas deterministas y validan el pipeline completo sin depender todavía de juicio visual.

## Criterios de aceptación

- [x] Detecta links internos con destino vacío, `#`, `javascript:void(0)` o placeholders configurados.
- [x] Detecta destinos internos que terminan en 4xx/5xx y conserva la cadena de redirects.
- [x] Diferencia recursos, navegación, requests canceladas deliberadamente y fallos first-party/third-party.
- [x] Emite finding por excepciones no controladas con ruta, timestamp y stack redactado si existe.
- [x] Emite finding por errores de consola, pero permite filtros explícitos para ruido conocido sin ocultarlo de la evidencia del run.
- [x] Emite finding por requests first-party fallidas o 5xx asociadas a carga/navegación.
- [x] Deduplica eventos repetidos por causa y ruta manteniendo contador y muestras.
- [x] No marca como rotos links `mailto`, `tel`, downloads o externos que no fueron autorizados para comprobarse.
- [x] Cada regla tiene fixture roto, al menos un caso correcto y un caso límite negativo.
- [x] Dos ejecuciones del mismo fixture producen los mismos IDs y fingerprints.

## Fuera de alcance

- Auditar todas las URLs externas.
- Juzgar warnings de consola genéricos como errores por defecto.
- Analizar causas en el código fuente.
- Reemplazar scanners de seguridad, SEO o dependencias.
