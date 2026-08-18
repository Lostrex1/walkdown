# 013 · Capa opcional de IA — Plan

## Enfoque

Crear un puerto de provider fuera del core determinista. Preparar paquetes de evidencia minimizados y redactados para tareas concretas. El resultado entra como `Inference` enlazada a facts existentes; no muta el finding original.

## Implementación

1. Definir `AIProvider`, `InferenceRequest`, `Inference`, provenance y data policy.
2. Implementar preflight de privacidad que enumera datos y requiere configuración opt-in.
3. Implementar evidence pack mínimo por tarea y redacción adicional.
4. Implementar primer provider mediante adapter separado y errores/timeouts no fatales.
5. Implementar explain, cause-grouping y journey-proposal antes de checks visuales bloqueantes.
6. Implementar revisión VLM experimental tras disponer de benchmark.
7. Integrar inferencias en JSON/Markdown/terminal sin alterar veredicto por defecto.
8. Crear fixtures grabados/mock providers y benchmark de precisión.

## Decisiones

- **IA fuera del core y opt-in** — protege local-first y reproducibilidad.
- **Evidence minimization** — enviar solo lo necesario para una tarea declarada.
- **Inferencias aditivas e inmutables** — nunca reescriben observaciones deterministas.
- **Sin blocking predeterminado** — los falsos positivos conocidos de agentes visuales hacen necesaria una política humana explícita.

## Riesgos

- **Privacidad/coste inesperados** — dry-run de payload, límites y métricas visibles.
- **Resultados no reproducibles** — provenance, prompts versionados y benchmark repetido; no prometer determinismo.
- **Provider lock-in** — interfaces neutrales y ninguna dependencia del core hacia SDK propietario.
- **Persuasión excesiva** — UI distingue claramente observed vs inferred y evita lenguaje de certeza no respaldado.
