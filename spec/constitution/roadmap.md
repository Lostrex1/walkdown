# Roadmap

El roadmap prioriza un vertical slice demostrable: explorar una aplicación real, encontrar defectos con evidencia, entregarlos a un agente y comprobar la corrección.

## Hecho

1. **001 · Fundamentos del CLI y configuración** — establece el paquete ejecutable, contratos públicos, configuración validada y lifecycle de un run.
2. **002 · Motor de navegador y evidencia base** — abre Chromium, captura observaciones y cierra de forma fiable.
3. **003 · Exploración segura y grafo de la aplicación** — descubre rutas y controles con presupuesto y clasificación de riesgo.
4. **004 · Checks de navegación y runtime** — detecta enlaces rotos/placeholders, excepciones, consola y requests fallidas.
5. **005 · Checks de interacción, responsive y accesibilidad funcional** — encuentra controles muertos, tapados, overflow y fallos básicos de teclado.
6. **006 · Findings, artefactos y outputs agent-native** — produce evidencia y contratos en terminal, JSON, JSONL, Markdown y SARIF.
7. **007 · Baseline, verificación focalizada y regresión** — distingue deuda conocida, confirma arreglos y detecta reapariciones.

## Siguiente

8. **008 · GitHub Action y experiencia de pull request** — integra Walkdown en CI y publica resultados y artefactos accionables.

## MVP — orden comprometido

El MVP termina cuando `001`–`008` satisfacen sus criterios y la demo completa scan → agent task → fix → verify → regression es reproducible.

## Evolución especificada

**Primera prioridad después del MVP:**

15. **015 · Integración opcional con Preflight** — combina launch-readiness y runtime QA en un informe y loop de agentes comunes mediante un adaptador, sin incluir ni reimplementar Preflight.

**Resto de evolución, pendiente de repriorización tras aprender del MVP:**

9. **009 · Registro de patrones y corpus comunitario** — permite contribuir bugs reproducibles con fixtures positivos y negativos.
10. **010 · Completitud de estados e inyección de fallos** — prueba empty, error, timeout, offline, sesión expirada y doble envío.
11. **011 · Journeys y sesiones autenticadas** — protege objetivos funcionales declarados y reutiliza estado de autenticación de prueba.
12. **012 · Protocolo de loops para agentes** — añade selección de trabajo, límites de autoridad, intentos y condición de parada estable.
13. **013 · Capa opcional de IA** — interpreta ambigüedad, propone journeys y explica resultados sin contaminar el núcleo determinista.
14. **014 · Runtime safety checks** — detecta señales observables de sesión, exposición de datos y operaciones críticas sin presentarse como auditoría de seguridad.

## Backlog / ideas

- **Firefox y WebKit** — ampliar cobertura cuando Chromium sea preciso y estable.
- **SDK de plugins externos** — cargar rulesets versionados sin comprometer seguridad ni reproducibilidad.
- **Tests exportables** — convertir journeys confirmados en tests Playwright mantenibles.
- **Integraciones con agentes** — skills/adapters para agentes concretos, manteniendo JSON como contrato neutral.
- **GitHub App** — comentarios, labels y propuestas de fix; solo después de probar la fiabilidad del CLI y la Action.
- **Comparación visual avanzada** — invariantes y VLM opcional con evidencia y política explícita de falsos positivos.
- **Dashboard local** — visor de runs y traces si la terminal y los artefactos resultan insuficientes.
- **Catálogo de integraciones** — aplicar el patrón probado con Preflight a Lighthouse, axe y scanners, sin convertir Walkdown en un agregador genérico sin identidad.
