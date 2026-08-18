# 010 · Completitud de estados e inyección de fallos — Plan

## Enfoque

Modelar escenarios como overlay explícito de red sobre un control run. Cada escenario declara matcher, mutación, alcance, expected recovery y safety. Ejecutar en contextos aislados y comparar con el control.

## Implementación

1. Definir `FaultScenario`, matchers, mutations, scope y recovery signals.
2. Implementar interceptor Playwright con log de requests modificadas y teardown garantizado.
3. Implementar control run y comparación causal por ruta/endpoint.
4. Implementar mutaciones empty, statuses, delay/timeout, abort/offline y body inválido.
5. Implementar reglas de infinite-loading, blank-error, unhandled-error y missing-feedback.
6. Implementar escenario de sesión expirada y doble activación bajo autorización.
7. Añadir target guard para producción y configuración de allowlist.
8. Crear fixtures con recuperación correcta e incorrecta por escenario.

## Decisiones

- **Opt-in explícito** — interceptar tráfico cambia el comportamiento y no pertenece al scan pasivo predeterminado.
- **Control antes del experimento** — evita atribuir al fallo inyectado un problema ya existente.
- **Recovery signals flexibles** — se evalúa resultado observable, no copy exacto.
- **Aislamiento por context** — evita que service workers, cache o sesión contaminen escenarios.

## Riesgos

- **Intercepción no representa backend real** — reportar el método y no prometer cobertura de servidor.
- **Service workers/cache evitan rutas** — detectar y marcar escenario no aplicado como inconclusive.
- **Explosión de escenarios** — presupuestos y selección por riesgo/importancia.
