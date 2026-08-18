# 005 · Checks de interacción, responsive y accesibilidad funcional — Plan

## Enfoque

Implementar un `StateProbe` que resume URL, DOM significativo, red, overlays, foco, dialogs y artefactos. Una acción segura se ejecuta en una página o contexto aislado cuando sea posible y se evalúa contra una matriz explícita de efectos. Los checks geométricos usan bounding boxes y hit testing; los de teclado usan eventos reales de Playwright.

## Implementación

1. Definir `PageStateDigest`, `InteractionAttempt`, `ObservableEffect` y resultado `pass/fail/inconclusive`.
2. Implementar normalización DOM que excluya regiones dinámicas configurables y atributos volátiles.
3. Capturar estado before/after, ejecutar acción segura y esperar por efectos o deadline, sin `networkidle`.
4. Implementar matriz de efectos y regla `interaction.dead-control`.
5. Implementar detección de pseudo-controles y semántica interactiva ausente.
6. Implementar mediciones por viewport, overflow, clipping, `elementFromPoint` y overlays.
7. Implementar inventario de nombres accesibles y recorrido de teclado acotado.
8. Implementar checks de foco de modal con fixture.
9. Crear fixtures de efectos válidos: navegación, modal, request, descarga, popup, DOM y feedback accesible.
10. Crear fixtures de animación/polling y referencias inestables para validar `inconclusive`.

## Decisiones

- **Cualquier efecto válido evita el finding dead-control** — Walkdown no adivina cuál era la intención si hay respuesta observable coherente.
- **Inconclusive es un resultado de primera clase** — se descarta convertir incertidumbre técnica en bug de producto.
- **Hit testing real** — la visibilidad CSS por sí sola no demuestra accionabilidad.
- **Presets de viewport, no dispositivos simulados exhaustivos** — cubre clases de layout sin multiplicar coste en el MVP.
- **A11y funcional mínima** — se enfoca en operabilidad; análisis normativo completo queda para integración externa.

## Riesgos

- **Mutaciones incidentales parecen éxito** — filtrar cambios volátiles y exigir causalidad temporal/espacial razonable.
- **Click dispara efectos tardíos** — ventana configurable y resultado inconclusive cuando sigue habiendo actividad relevante.
- **Tests de teclado caros** — limitar controles/ruta y detenerse al detectar ciclos.
- **Layouts responsivos no estabilizados** — esperar fonts/layout acotadamente y registrar dimensiones junto a evidencia.
