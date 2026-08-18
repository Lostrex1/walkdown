# Misión

## Qué construimos

Walkdown es una herramienta open-source, local-first y orientada a agentes que ejecuta una aplicación web en un navegador real, la recorre e interactúa con ella para descubrir fallos de comportamiento antes del despliegue.

Actúa como un **linter de comportamiento web**: complementa el análisis de código, SEO, dependencias y configuración comprobando lo que un usuario realmente puede observar.

Sus piezas principales son:

1. **Explorador seguro** — descubre rutas, controles y estados mediante Playwright sin ejecutar acciones destructivas por defecto.
2. **Motor de reglas** — transforma observaciones deterministas del navegador en findings reproducibles.
3. **Sistema de evidencia** — conserva screenshots, traces, red, consola y datos antes/después de cada fallo.
4. **Contrato para agentes** — expresa cada finding como una tarea estructurada con objetivo, restricciones, aceptación y verificación.
5. **Capa de regresión** — compara ejecuciones, verifica correcciones y protege pull requests mediante baseline y CI.
6. **Corpus comunitario** — mantiene patrones y aplicaciones mínimas deliberadamente rotas para medir precisión y evitar falsos positivos.
7. **Orquestación opcional de checks de lanzamiento** — después del MVP integra Preflight como proveedor externo y normaliza sus resultados dentro del mismo contrato y loop de agentes, sin absorber su código ni perder la identidad runtime de Walkdown.

## Para quién

- **Vibecoders y makers sin experiencia profunda en QA**, que necesitan saber qué olvidó o dejó incompleto el código generado por IA.
- **Desarrolladores y equipos técnicos**, que buscan una última capa automática de runtime QA antes de desplegar.
- **Agentes de programación**, que necesitan findings estructurados y verificables para entrar en un loop de corrección.
- **Contribuidores open-source e investigadores**, que pueden aportar patrones reproducibles y medir la calidad de la detección.

## Principios

- **Evidencia antes que opinión** — un finding debe explicar qué acción se ejecutó, qué se observó y cómo reproducirlo. Los hechos, inferencias y recomendaciones permanecen separados.
- **Determinista por defecto** — el núcleo no requiere LLM, cuenta ni API key. La IA es una capa opcional y sus resultados se identifican como inferencias.
- **Seguro por defecto** — Walkdown evita pagos, borrados, publicaciones, invitaciones, emails, navegación externa y otras mutaciones sin autorización explícita.
- **Agent-native, human-readable** — JSON versionado es el contrato canónico; terminal, Markdown, SARIF y prompts son representaciones del mismo modelo.
- **Verificar, no asumir** — una corrección solo se considera resuelta cuando Walkdown deja de reproducir el finding y la regresión no introduce fallos nuevos.
- **Precisión antes que cantidad** — se priorizan reglas respaldadas por fixtures positivos y negativos; no se compite por acumular checks ni por producir un score vacío.
- **Local-first y portable** — el análisis y sus artefactos pertenecen al usuario y deben funcionar en localhost y CI sin servicio cloud.
- **Composición antes que reimplementación** — cuando otra herramienta open-source resuelve bien un dominio adyacente, Walkdown la integra mediante un adaptador opcional, conserva su autoría y evita duplicar su mantenimiento.

## Qué NO es

- No es una garantía de seguridad, conformidad legal o preparación absoluta para producción.
- No sustituye una auditoría profesional, una suite E2E del dominio ni una revisión humana de flujos críticos.
- No es otro auditor generalista de SEO, metadatos, secretos, dependencias o configuración; se integra o convive con herramientas especializadas.
- No es una distribución, fork o rebranding de Preflight; su futura integración ejecuta el CLI oficial instalado y conserva la procedencia de sus findings.
- No modifica código automáticamente en el MVP.
- No hace clic indiscriminadamente ni prueba acciones potencialmente destructivas sin consentimiento.
- No bloquea un despliegue por una inferencia de IA salvo que el usuario configure expresamente esa política.
- No requiere dashboard, cuenta o backend alojado para aportar su valor principal.
