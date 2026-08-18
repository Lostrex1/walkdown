# 004 · Checks de navegación y runtime

**Estado:** propuesta

## Qué hace

Interpreta observaciones pasivas del scan para detectar defectos de alta confianza: enlaces internos rotos, destinos vacíos/placeholder, redirecciones problemáticas, excepciones JavaScript, errores relevantes de consola y requests first-party fallidas.

## Por qué

Estos fallos son frecuentes, tienen evidencia objetiva y no requieren interacciones arriesgadas. Constituyen el primer conjunto útil de reglas deterministas y validan el pipeline completo sin depender todavía de juicio visual.

## Criterios de aceptación

- [ ] Detecta links internos con destino vacío, `#`, `javascript:void(0)` o placeholders configurados.
- [ ] Detecta destinos internos que terminan en 4xx/5xx y conserva la cadena de redirects.
- [ ] Diferencia recursos, navegación, requests canceladas deliberadamente y fallos first-party/third-party.
- [ ] Emite finding por excepciones no controladas con ruta, timestamp y stack redactado si existe.
- [ ] Emite finding por errores de consola, pero permite filtros explícitos para ruido conocido sin ocultarlo de la evidencia del run.
- [ ] Emite finding por requests first-party fallidas o 5xx asociadas a carga/navegación.
- [ ] Deduplica eventos repetidos por causa y ruta manteniendo contador y muestras.
- [ ] No marca como rotos links `mailto`, `tel`, downloads o externos que no fueron autorizados para comprobarse.
- [ ] Cada regla tiene fixture roto, al menos un caso correcto y un caso límite negativo.
- [ ] Dos ejecuciones del mismo fixture producen los mismos IDs y fingerprints.

## Fuera de alcance

- Auditar todas las URLs externas.
- Juzgar warnings de consola genéricos como errores por defecto.
- Analizar causas en el código fuente.
- Reemplazar scanners de seguridad, SEO o dependencias.
