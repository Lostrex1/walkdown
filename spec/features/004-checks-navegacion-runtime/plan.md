# 004 · Checks de navegación y runtime — Plan

## Enfoque

Definir una interfaz de regla pura que recibe un contexto de página/run y devuelve borradores de finding basados en observaciones. El core común se encarga de IDs, fingerprints, severidad y deduplicación; las reglas no escriben artefactos ni salida.

## Implementación

1. Definir `Rule`, `RuleContext`, `FindingDraft`, `RuleMetadata` y registro interno.
2. Implementar utilidades de clasificación first-party, navegación, resource type, redirect y cancelación esperada.
3. Implementar `navigation.placeholder-link` y `navigation.broken-internal-link`.
4. Implementar `runtime.page-error`, `runtime.console-error` y `runtime.failed-request`.
5. Implementar deduplicación, agrupación, contador de ocurrencias y fingerprints estables.
6. Añadir configuración por regla: enabled, severity y filtros permitidos.
7. Crear fixtures individuales y una app combinada para probar interacción entre reglas.
8. Añadir tests de casos negativos y snapshot del resultado semántico.

## Decisiones

- **Reglas puras sobre hechos capturados** — facilita tests rápidos y replay sin volver a navegar.
- **Una causa agrupada, múltiples muestras** — evita inundar al usuario sin ocultar alcance.
- **First-party prioritaria** — terceros se registran, pero no bloquean por defecto debido a ruido y falta de control.
- **Severidad configurable, semántica fija** — el usuario adapta política sin cambiar qué significa la regla.
- **Sin score agregado** — se comunica impacto y cobertura, no una nota arbitraria.

## Riesgos

- **Errores benignos de frameworks** — fixtures reales, filtros acotados y severidad warning cuando la causalidad sea débil.
- **Fingerprint inestable por mensajes dinámicos** — normalizar UUIDs, timestamps, puertos y valores variables antes de hashear.
- **Redirects legítimos** — solo fallar cadenas rotas/loop; las cadenas largas son warning configurable.
