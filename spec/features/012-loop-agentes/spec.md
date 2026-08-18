# 012 · Protocolo de loops para agentes

**Estado:** propuesta

## Qué hace

Expone comandos y estados para que un agente seleccione el siguiente finding, aplique una corrección bajo límites definidos, verifique y continúe hasta alcanzar un fixpoint o agotar presupuesto.

Walkdown sigue siendo el verificador; no necesita alojar ni controlar el agente concreto.

## Por qué

JSON permite integración básica, pero un loop robusto necesita orden de trabajo, leases, intentos, autoridad, condiciones de parada y prevención de ciclos. Formalizarlo evita prompts ad hoc y reparaciones que nunca se comprueban.

## Criterios de aceptación

- [ ] `walkdown next --format json` devuelve como máximo una unidad de trabajo no bloqueada con dependencias y prioridad explícitas.
- [ ] Una work item incluye finding, evidencia, objetivo, restricciones, aceptación y comando de verify.
- [ ] El estado del loop registra intentos, resultado de verify, regresiones y razón de parada sin almacenar reasoning privado del agente.
- [ ] La política limita iteraciones, tiempo, archivos/áreas permitidas, instalación de dependencias y clases sensibles declaradas por el usuario.
- [ ] Walkdown no otorga permisos del sistema ni elude aprobaciones del harness del agente.
- [ ] Tras un FAIL, el finding puede reintentarse hasta budget; tras INCONCLUSIVE no se marca fixed.
- [ ] Tras PASS se ejecuta regresión configurada antes de cerrar la work item.
- [ ] Se detecta ciclo cuando fingerprints/diff/resultados se repiten sin progreso y se detiene con diagnóstico.
- [ ] El loop termina en `stable`, `budget-exhausted`, `blocked`, `regression`, `cancelled` o `error`.
- [ ] Adaptadores para agentes concretos son opcionales; el protocolo funciona solo con CLI/JSON.

## Fuera de alcance

- Ejecutar un modelo propio o facturar inferencia.
- Modificar repositorios sin que un agente/humano externo lo haga.
- Aprobar automáticamente cambios de auth, pagos, datos o infraestructura.
- Garantizar que una reparación sea arquitectónicamente buena más allá de sus verificaciones.
