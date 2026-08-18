# 010 · Completitud de estados e inyección de fallos

**Estado:** propuesta

## Qué hace

Permite volver a cargar rutas bajo respuestas controladas para comprobar estados frecuentemente olvidados: datos vacíos, 4xx/5xx, timeout, offline, respuesta malformada, sesión expirada y doble envío. Observa si la UI sale de loading, comunica el problema y permanece operable.

## Por qué

Las aplicaciones generadas por IA suelen implementar el happy path y asumir que red, sesión y datos siempre funcionan. Estos fallos aparecen en producción aunque los controles básicos pasen.

## Criterios de aceptación

- [ ] El usuario opta explícitamente por escenarios de fault injection y puede limitar rutas/endpoints.
- [ ] Se interceptan solo requests que coinciden con reglas declaradas y se registra cada modificación.
- [ ] Existen escenarios para empty, 401/403, 404, 500, timeout, offline y payload inválido.
- [ ] La ejecución original sin inyección se conserva como control y un fallo preexistente no se atribuye al escenario.
- [ ] Se detecta loading que supera deadline, pantalla vacía, excepción, ausencia de feedback y control inutilizable tras error.
- [ ] Se prueba doble activación segura solo sobre fixtures o endpoints explícitamente autorizados.
- [ ] Los resultados separan fallo de aplicación, fallo de harness e inconclusive.
- [ ] No se inyectan fallos en producción por defecto; targets no locales requieren confirmación/configuración explícita.
- [ ] Cada escenario tiene criterio de recuperación, no un único texto esperado.

## Fuera de alcance

- Chaos engineering de infraestructura o carga.
- Modificar bases de datos o proveedores reales.
- Inferir automáticamente contratos de negocio complejos.
- Garantizar idempotencia del backend sin observabilidad del servidor.
