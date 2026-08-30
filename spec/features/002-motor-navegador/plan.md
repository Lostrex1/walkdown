# 002 · Motor de navegador y evidencia base — Plan

## Enfoque

Crear una abstracción `BrowserSession` que exponga eventos de dominio y no objetos Playwright fuera del adaptador. Instalar todos los listeners antes de `goto`, usar un reloj monotónico para ordenar observaciones y cerrar recursos mediante un único scope de lifecycle.

## Implementación

1. Añadir Playwright y comprobar explícitamente la disponibilidad de Chromium sin instalarlo de forma implícita.
2. Definir `Observation`, `EvidenceRef`, `PageState` y límites de captura en core.
3. Implementar adaptador Playwright con launch/context/page y cabecera de identificación configurable.
4. Implementar recolectores de navegación, consola, excepciones, red, dialogs, downloads y popups.
5. Implementar snapshots de página: URL, title, accessibility tree resumido, screenshot y metadatos DOM seguros.
6. Implementar `ArtifactWriter` con nombres deterministas, límites, redacción y manifest.
7. Integrar trace y cierre idempotente en el lifecycle del run.
8. Crear fixture con eventos conocidos y tests de éxito, error, timeout, crash y cancelación.

## Decisiones

- **Playwright aislado tras un puerto interno** — facilita testear y añadir navegadores sin contaminar reglas.
- **Observaciones append-only** — preservan la trayectoria; las vistas derivadas no reescriben hechos.
- **Redacción previa a persistencia** — se descarta guardar todo y limpiar después porque amplía el riesgo de filtración.
- **Screenshots y trace bajo demanda** — son binarios que no se pueden redactar de forma fiable; permanecen desactivados hasta un opt-in informado.
- **Sin `networkidle` como señal de estabilidad** — se usa una ventana de asentamiento acotada y eventos observables.

## Riesgos

- **Ruido de terceros** — etiquetar origen first-party/third-party y permitir filtros sin borrar la observación cruda redactada.
- **Artefactos muy grandes** — límites por run y truncado explícito, nunca silencioso.
- **Listeners perdidos o duplicados** — instalación centralizada y tests que emiten eventos antes/durante/después de navegación.
- **Flakiness temporal** — reloj monotónico, waits por condición y fixture controlado; evitar sleeps como aserción principal.
