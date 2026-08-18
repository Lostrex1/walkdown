# 015 · Integración opcional con Preflight — Plan

## Enfoque

Implementar un puerto interno mínimo `CheckProvider` y un adaptador `PreflightProvider` fuera del core de navegador. El provider resuelve el ejecutable, negocia versión, ejecuta el proceso con argumentos estructurados, valida JSON y devuelve findings con procedencia. El orquestador compone resultados inmutables; no interpreta Preflight como si fuera una regla nativa.

Antes de implementar, abrir una conversación upstream para comunicar la integración y proponer, si es útil, un JSON Schema/versionado estable. La licencia MIT permite la integración y redistribución bajo sus condiciones, pero se opta por invocar el CLI oficial para minimizar mantenimiento y respetar identidad/marca.

## Implementación

1. Documentar la versión mínima/máxima de Preflight validada y capturar golden outputs reales de releases soportadas.
2. Definir `CheckProvider`, `ProviderCapabilities`, `ProviderRun`, `ProviderError`, `FindingSource` y executor de verificación.
3. Implementar resolver de ejecutable local/ruta explícita y `doctor` diagnóstico, sin auto-install ni `npx --yes`.
4. Implementar detección de versión/capabilities y rechazo claro de incompatibilidades.
5. Implementar process runner sin shell, con cwd, timeout, cancelación, stdout/stderr separados y límites de tamaño.
6. Implementar parser/validator del JSON de Preflight y matriz de exit codes a estados Walkdown.
7. Implementar normalización de IDs, severidades, fingerprints, mensajes, evidencia, reparación y verification recipe preservando el valor original.
8. Implementar `walkdown audit`, ejecución de providers configurados y veredicto `pass/fail/incomplete` combinado.
9. Implementar reportes agrupados por provider y enlaces de relación opcionales sin deduplicación destructiva.
10. Integrar baseline, suppressions, verify y regression por provider/version.
11. Integrar la cola de agentes para que el work item invoque siempre el executor del provider que originó el finding.
12. Extender GitHub Action, artifacts, SARIF/summary y documentación de version pinning.
13. Añadir attribution, THIRD_PARTY_NOTICES si corresponde, enlace a licencia y guía de troubleshooting.
14. Probar binario ausente, versiones soportadas/no soportadas, todos los exit codes, output inválido, cancelación, Windows/Linux/macOS y coexistencia con findings nativos.

## Decisiones

- **Adaptador opcional, no código incluido** — evita mantener el proyecto Go, decenas de integraciones y releases multiplataforma dentro de Walkdown.
- **Dos comandos con identidad distinta** — `scan` sigue significando comportamiento Walkdown; `audit` compone proveedores y evita que el producto se vuelva conceptualmente genérico.
- **Configuraciones separadas** — Preflight continúa gobernado por `preflight.yml`; Walkdown solo configura la integración.
- **Instalación explícita y versión fijada** — se descarta descargar `latest` durante el scan por reproducibilidad y supply-chain safety.
- **Procedencia preservada** — IDs namespaced y `FindingSource` impiden apropiarse de resultados o confundir al usuario.
- **Verificación por provider original** — Walkdown coordina el loop, pero no declara corregido un check de Preflight usando una heurística propia.
- **Provider incompleto no equivale a PASS** — un fallo de integración no invalida resultados nativos, pero impide afirmar que el audit completo pasó.
- **Sin auto-ignore** — los agentes deben reparar; las suppressions requieren una decisión explícita, razón y, cuando proceda, expiración.
- **Relación antes que fusión** — checks solapados se pueden enlazar como posible causa común, pero conservan semántica y lifecycle independientes.

## Riesgos

- **Cambios no versionados en el JSON de Preflight** — version negotiation, validator estricto, golden fixtures y estado `provider-incompatible` en vez de parseo tolerante engañoso.
- **Sobrecarga de producto** — mantener Preflight detrás de `audit`, posterior al MVP y fuera del mensaje principal «behavioral runtime QA».
- **Confusión de marca o autoría** — attribution visible, naming «integration for Preflight.sh» y coordinación upstream antes de anunciar respaldo oficial.
- **Supply-chain y ejecución de procesos** — binario instalado explícitamente, version pin, sin shell y sin descargas automáticas.
- **Severidades incompatibles** — conservar severidad nativa, documentar el mapping y mantener la política Walkdown como capa separada.
- **Duplicados entre providers** — mostrar relaciones sugeridas sin eliminar findings ni alterar sus verificaciones.
- **Agente usa ignore como arreglo** — work item prohíbe suppressions automáticas y verify exige que el check original pase.
- **Mantenimiento del adapter** — limitar versiones soportadas y aportar mejoras de schema upstream cuando reduzcan fragilidad.
