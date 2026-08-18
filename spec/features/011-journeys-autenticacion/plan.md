# 011 · Journeys y sesiones autenticadas — Plan

## Enfoque

Crear un DSL pequeño de acciones y aserciones de usuario sobre primitives ya soportadas. Compilarlo a la misma `VerificationRecipe` del core. Mantener secretos como referencias nunca materializadas en resultados.

## Implementación

1. Definir schema `Journey`, steps, assertions, variables, safety y cleanup.
2. Implementar loader y resolver de variables con redacción by construction.
3. Implementar acciones navigate, click, fill, select y submit bajo política.
4. Implementar aserciones URL, visible, accessible text, dialog, request outcome y state change.
5. Integrar storageState con paths fuera de artifacts y warning de gitignore.
6. Implementar runner paso a paso, screenshots/traces y clasificación de fallo.
7. Integrar journeys en verify, regression, outputs y exit policy.
8. Crear fixtures de signup simulado, CRUD reversible, sesión expirada y logout.

## Decisiones

- **DSL limitado** — para lógica avanzada el usuario puede mantener Playwright tests; Walkdown conserva una capa portable.
- **No guardar inputs de fill** — la evidencia muestra nombre del campo y origen de variable, no valor.
- **Side effects explícitos** — journey declarado no implica permiso universal; cada clase se autoriza.
- **Confirmación humana de intención** — propuesta automática futura nunca se convierte sola en gate.

## Riesgos

- **Fragilidad de locators** — semántica accesible, diagnóstico de ambigüedad y no auto-healing silencioso.
- **Datos contaminados** — IDs únicos, cleanup y documentación de entornos desechables.
- **Fuga de sesión** — permisos de archivo, gitignore, redacción y nunca adjuntar storageState.
