# 012 · Protocolo de loops para agentes — Plan

## Enfoque

Modelar una máquina de estados persistida localmente sobre runs y VerificationRecipes. Mantener el protocolo neutral: Walkdown emite work items y consume resultados de verify/regression; adaptadores solo traducen.

## Implementación

1. Definir schemas `AgentPolicy`, `WorkItem`, `Attempt`, `LoopState` y stop reasons.
2. Implementar priorización determinista por estado, severidad, confianza, dependencia y coste estimado.
3. Implementar `next`, `loop status`, `attempt start/end` y locking local.
4. Integrar verify y regression como gates obligatorios de transición.
5. Implementar budgets de intentos/tiempo y detección de repetición sin progreso.
6. Renderizar instrucciones humanas/prompt desde work item, manteniendo JSON canónico.
7. Implementar un harness fake de agente para tests end-to-end.
8. Publicar protocolo y ejemplos de integración neutral.

## Decisiones

- **Una work item por defecto** — reduce cambios conflictivos y facilita atribuir regresiones.
- **No almacenar chain-of-thought** — solo acciones, resultados y evidencia operacional.
- **Política declarativa, enforcement compartido** — Walkdown valida su parte, pero no promete controlar capacidades externas del agente.
- **Fixpoint observable** — stable significa sin work items elegibles y regresión verde, no «el agente cree que terminó».

## Riesgos

- **Sensación falsa de sandbox** — explicar límites y no llamar seguridad a restricciones que dependen del harness externo.
- **Starvation de findings complejos** — prioridades transparentes y opción de selección manual.
- **Loops por fingerprints cambiantes** — usar equivalencia de causa además de identidad exacta para diagnóstico, sin fusionar silenciosamente.
