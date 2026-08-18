# 001 · Fundamentos del CLI y configuración

**Estado:** propuesta

## Qué hace

Entrega un CLI instalable llamado `walkdown` capaz de validar sus argumentos y configuración, preparar un run local y finalizar con resultados y exit codes estables. El primer comando público será `walkdown scan <url>` aunque todavía no navegue en esta feature.

El usuario puede configurar target, límites de exploración, viewports, timeouts, rutas incluidas/excluidas, política de seguridad, reglas y directorio de salida mediante `walkdown.config.yaml`, con precedencia explícita: CLI > variables de entorno documentadas > archivo > defaults.

## Por qué

Todos los componentes posteriores dependen de contratos estables para configuración, lifecycle, errores, archivos y compatibilidad de máquina. Definirlos primero evita que el motor del navegador dicte accidentalmente la arquitectura pública.

## Criterios de aceptación

- [ ] El paquete se instala y expone `walkdown --help` y `walkdown --version` en Node.js 22+.
- [ ] `walkdown scan <url>` acepta HTTP/HTTPS y rechaza targets inválidos con mensaje, código de error estable y exit code de invocación.
- [ ] La configuración YAML y los flags se validan, fusionan con precedencia documentada y pueden mostrarse redactados mediante `--print-config`.
- [ ] Una clave desconocida o una versión de schema incompatible falla de forma explícita; no se ignora silenciosamente.
- [ ] Cada ejecución crea de forma atómica `.walkdown/runs/<run-id>/run.json` con target normalizado, configuración efectiva, versión y timestamps.
- [ ] Las señales `SIGINT` y `SIGTERM` dejan un run con estado `cancelled` y no un archivo parcialmente escrito.
- [ ] Los exit codes distinguen: éxito, findings que incumplen política, scan incompleto y error de uso/infraestructura.
- [ ] La salida respeta `NO_COLOR` y dispone de un modo silencioso/machine-readable sin logs mezclados en stdout.
- [ ] Linux, Windows y macOS tienen tests de smoke del CLI y manejo correcto de rutas.

## Fuera de alcance

- Lanzar Playwright o descubrir páginas; corresponde a `002` y `003`.
- Implementar reglas reales o reporters finales.
- Iniciar automáticamente el servidor de la aplicación inspeccionada.
- Crear una interfaz gráfica o servicio cloud.
