# 012 · Protocolo de loops para agentes — Tareas

- [ ] Definir schemas de política, work item, attempt y loop.
- [ ] Implementar priorización y dependencias.
- [ ] Implementar comandos next/status y persistencia atómica.
- [ ] Implementar locking y recuperación tras interrupción.
- [ ] Integrar verify/regression como gates.
- [ ] Implementar budgets y stop reasons.
- [ ] Implementar detección de ciclos/no progreso.
- [ ] Implementar vistas agent/human desde el mismo work item.
- [ ] Crear fake agent harness y tests completos.
- [ ] Documentar límites de autoridad y ejemplos.
- [ ] Validar todos los criterios de `spec.md`.
- [ ] Mover la feature a «Hecho» en `../../constitution/roadmap.md`.

## Mantenimiento

- [ ] Los adaptadores nunca pueden cambiar el significado del protocolo canónico ni saltar verify/regression.
