# 008 · GitHub Action y experiencia de pull request — Plan

## Enfoque

Crear una JavaScript Action delgada que prepara inputs, espera al target, ejecuta el binario y publica outputs. La lógica de scan, comparación y exit code permanece en el CLI. Usar mecanismos oficiales de artifacts, summary y SARIF con permisos mínimos.

## Implementación

1. Definir `action.yml`, inputs/outputs y matriz de permisos documentada.
2. Implementar health wait con URL/timeout configurables y logs diagnósticos.
3. Resolver versión del CLI y Chromium de manera reproducible y cacheable.
4. Ejecutar scan/regression preservando exit code y paths de resultados.
5. Renderizar Job Summary desde `results.json` y comparison result.
6. Subir artifacts con retención/nombres configurables y reglas de privacidad.
7. Integrar SARIF upload condicionado a permisos disponibles.
8. Crear workflows fixture para push, PR interno, fork sin secrets, timeout y findings.
9. Añadir documentación copy-ready y estrategia de tags mayores (`v1`).

## Decisiones

- **Action delgada sobre CLI** — una única semántica local/CI.
- **El usuario inicia su aplicación** — evita adivinar framework, comandos y puertos.
- **Permisos mínimos y forks tratados como no confiables** — no se usa `pull_request_target` para ejecutar código de PR.
- **Job Summary antes que comentarios** — no requiere permisos de escritura ni genera spam.
- **Artifacts aun en fallo de findings** — evidencia debe sobrevivir para diagnóstico.

## Riesgos

- **Browser download lento** — cache documentada y uso de imagen/instalación oficial; medir antes de optimizar.
- **SARIF sin líneas de código** — comunicarlo como resultados web y no fingir precisión de fuente.
- **Fugas en artifacts** — defaults sin sesión, redacción, retención corta y opción de desactivar evidencia pesada.
- **Procesos de servidor huérfanos** — recomendar patrón de workflow y cleanup; Action no se apropia de procesos ajenos.
