# 002 · Motor de navegador y evidencia base

**Estado:** implementado

## Qué hace

Walkdown abre el target en Chromium mediante Playwright, captura hechos del runtime y finaliza una sesión reproducible. Registra navegación, consola, excepciones, requests/responses, dialogs, descargas, nuevas páginas, accessibility snapshot, screenshot y trace.

La feature todavía no explora múltiples rutas ni emite reglas de producto: establece una observabilidad fiable sobre una sola página.

## Por qué

El valor de Walkdown depende de evidencia real. Centralizar la instrumentación evita listeners inconsistentes entre reglas y permite separar «qué ocurrió» de «cómo se interpreta».

## Criterios de aceptación

- [x] El CLI abre una URL disponible en Chromium con viewport y timeout configurados.
- [x] Una URL inaccesible, timeout de navegación o crash del navegador produce un error tipado y run `incomplete`, no un falso PASS.
- [x] Se capturan en orden errores de consola, page errors y requests fallidas desde antes de la navegación inicial.
- [x] Se registran status, método, tipo y URL de red sin persistir headers/cuerpos sensibles por defecto.
- [x] Se detectan dialog, download, popup y cambio de URL como observaciones estructuradas.
- [x] Se guardan screenshot inicial y trace reproducible dentro del directorio del run.
- [x] Las evidencias contienen rutas relativas y pasan por una política de redacción.
- [x] Browser, context, pages y trace se cierran en éxito, error, timeout y cancelación.
- [x] El mismo fixture produce observaciones semánticamente equivalentes en ejecuciones consecutivas.
- [x] El overhead de captura está acotado y los límites de tamaño de artefactos son configurables.

## Fuera de alcance

- Hacer clic automáticamente o rellenar formularios.
- Interpretar consola o red como findings.
- Firefox, WebKit, grabación de vídeo o subida remota de traces.
- Guardar cuerpos completos de requests/responses.
