# 007 · Baseline, verificación focalizada y regresión — Plan

## Enfoque

Tratar baseline y comparación como funciones puras sobre resultados versionados. Guardar en cada finding una `VerificationRecipe` portable y segura. Verify vuelve a observar el comportamiento; nunca infiere la corrección por cambios de código o desaparición accidental del selector.

## Implementación

1. Definir schemas `Baseline`, `Suppression`, `ComparisonResult`, executor de verificación y versión de fingerprint/rule.
2. Implementar creación y actualización explícita de baseline desde un run completo.
3. Implementar comparación por fingerprint y clasificación de estados.
4. Implementar política de fallo por estado/severidad y resumen de delta.
5. Persistir recetas de navegación, reidentificación, acción y aserción para findings verificables.
6. Implementar `verify` con precondiciones, presupuesto corto y resultado tri-state.
7. Implementar `regression` y selección de reglas/rutas afectadas con fallback a scan completo cuando no sea seguro reducir.
8. Implementar suppressions con razón, autor opcional y expiración.
9. Añadir tests de estabilidad, evolución de reglas y migración de baseline.

## Decisiones

- **Baseline contiene identidad, no evidencia pesada** — debe ser revisable y apto para Git.
- **Elemento no encontrado es inconclusive** — desaparecer del DOM no demuestra que la función esté arreglada.
- **Actualización de baseline siempre explícita** — CI nunca acepta deuda nueva automáticamente.
- **Recetas semánticas** — rol/nombre/ruta prevalecen sobre selectores CSS frágiles.
- **Fallback conservador** — si no se puede probar que un scan reducido cubre la regresión, se ejecuta el completo.

## Riesgos

- **Fingerprints cambian por copy/layout** — definir componentes de identidad por regla y versionarlos.
- **Verify no reproduce precondiciones** — registrar pasos mínimos y devolver inconclusive con evidencia del punto de fallo.
- **Baseline usado para ocultar bugs** — razones obligatorias, diff legible y no aceptar updates implícitos.
