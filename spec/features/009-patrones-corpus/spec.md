# 009 · Registro de patrones y corpus comunitario

**Estado:** propuesta

## Qué hace

Formaliza una manera segura y versionada de añadir patrones de bugs y aplicaciones mínimas que demuestran cuándo una regla debe fallar, pasar o quedar inconclusa. Ofrece comandos para validar y ejecutar el corpus.

## Por qué

La colección de fallos reproducibles puede convertirse en el principal activo comunitario del proyecto. También protege la precisión: una regla no entra solo por parecer razonable, sino por demostrar detección y ausencia de falsos positivos conocidos.

## Criterios de aceptación

- [ ] Existe un schema versionado para metadata de patrón: ID, categoría, aplicabilidad, seguridad, condición, explicación, reparación y aceptación.
- [ ] Cada patrón incluye al menos un fixture roto, uno correcto y un caso límite o justificación de ausencia.
- [ ] `walkdown patterns validate` detecta schema inválido, IDs duplicados, evidencia ausente y fixtures sin expectativas.
- [ ] `walkdown corpus run` ejecuta casos de forma aislada y publica precisión por regla, falsos positivos, falsos negativos, tiempo y estabilidad.
- [ ] El corpus no contiene secretos, código privado ni datos reales de usuarios y documenta licencia/procedencia.
- [ ] Las reglas imperativas pueden participar mediante un adapter sin obligar a expresar toda lógica compleja en YAML.
- [ ] Un contributor puede añadir un bug siguiendo una guía y plantilla sin conocer internals completos del motor.
- [ ] CI exige corpus verde para aceptar cambios de reglas.
- [ ] Cambios de comportamiento esperados requieren revisar explícitamente los snapshots afectados.

## Fuera de alcance

- Descargar o ejecutar patterns remotos no confiables en el proceso principal.
- Usar el corpus como entrenamiento sin revisión legal/licencias.
- Marketplace o ranking de plugins.
