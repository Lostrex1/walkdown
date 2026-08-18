# Tech stack y convenciones

## Tecnologías

- **Lenguaje:** TypeScript estricto, ESM y APIs públicas tipadas.
- **Runtime:** Node.js 22 o superior.
- **Navegador:** Playwright; Chromium es obligatorio en el MVP.
- **Validación:** esquemas runtime para configuración, patrones y resultados; los esquemas públicos se versionan.
- **Persistencia:** sistema de archivos local en `.walkdown/`; no hay base de datos.
- **Tests:** Vitest para unidad/integración y Playwright contra aplicaciones fixture para pruebas end-to-end.
- **Calidad:** TypeScript, Biome y tests ejecutados mediante un comando agregado.
- **Distribución:** paquete npm que expone el binario `walkdown`; GitHub Releases y Action oficial cuando corresponda.
- **CI:** GitHub Actions en Linux, con pruebas de contratos de CLI y rutas en Windows y macOS.

## Organización prevista

- `packages/cli/` — comandos, exit codes, renderizado de terminal y coordinación de una ejecución.
- `packages/core/` — sesiones, crawler, política de seguridad, observaciones, fingerprints y comparación de runs.
- `packages/rules/` — reglas deterministas incluidas y registro de patrones.
- `packages/reporters/` — JSON, JSONL, Markdown, SARIF y resumen humano.
- `packages/testkit/` — fixtures, servidores de prueba y utilidades para autores de reglas.
- `packages/action/` — wrapper de GitHub Action cuando se implemente la feature `008`.
- `packages/providers/` — adaptadores opcionales para CLIs externos; comienza con Preflight después del MVP y no forma parte del core de navegador.
- `schemas/` — JSON Schema publicados para configuración, findings, runs y patrones.
- `fixtures/` — aplicaciones mínimas rotas y casos correctos de control.
- `spec/` — requisitos, planes y tareas; fuente de verdad del producto.
- `.walkdown/` — resultados locales generados; ignorados por Git salvo baseline o configuración elegidos por el usuario.

La estructura puede simplificarse durante `001`, pero los límites de responsabilidad deben conservarse y no se crearán paquetes vacíos por anticipado.

## Comandos objetivo

- `npm run dev` — ejecuta el CLI desde TypeScript durante desarrollo.
- `npm run build` — compila todos los paquetes publicables.
- `npm run typecheck` — valida tipos sin emitir archivos.
- `npm run lint` — comprueba estilo y errores estáticos.
- `npm run format` — aplica formato.
- `npm test` — ejecuta la suite completa.
- `npm run test:unit` — ejecuta tests rápidos.
- `npm run test:e2e` — ejecuta fixtures con navegador.
- `npm run check` — ejecuta typecheck, lint y build.

## Modelo de dominio

- **Run** — ejecución inmutable con `runId`, target normalizado, timestamps, versión, configuración efectiva, cobertura, estado y findings.
- **Route** — URL interna normalizada y estado de página descubierto durante el recorrido.
- **ElementRef** — referencia portable basada en rol, nombre accesible, texto, atributos y contexto; los selectores CSS son solo una pista.
- **Action** — interacción intentada, su clasificación de riesgo, precondiciones y resultado.
- **Observation** — hecho capturado: navegación, mutación significativa, request, dialog, descarga, error, foco o geometría.
- **Finding** — violación de una regla con fingerprint estable, severidad, confianza, evidencia, reparación y verificación.
- **Evidence** — artefacto o dato asociado a un finding mediante ruta relativa y tipo conocido.
- **Pattern** — definición versionada de aplicabilidad, observaciones, condición de fallo, explicación y aceptación.
- **Baseline** — conjunto versionado de fingerprints aceptados en una revisión concreta.
- **Journey** — objetivo funcional y trayectoria observada, incorporado después del MVP.
- **Provider** — integración opcional que ejecuta una herramienta externa, valida su versión/output y transforma sus resultados sin borrar su procedencia.
- **FindingSource** — identidad del productor mediante `provider`, `providerVersion`, `nativeId` y versión del adaptador.

## Contratos públicos

- Los identificadores de reglas usan namespace: `interaction.dead-control`.
- Los findings externos usan namespace del proveedor, por ejemplo `preflight.seo-meta`, y conservan siempre `FindingSource`.
- Los fingerprints son estables frente a cambios irrelevantes de DOM y nunca dependen de `runId`.
- Los timestamps usan ISO 8601 UTC; las URLs se normalizan; las rutas de artefactos son relativas al directorio del run.
- La severidad pública es `info | warning | error | blocking`.
- El estado es `new | persistent | fixed | regressed | ignored | inconclusive`.
- Todo JSON público incluye `schemaVersion` y rechaza versiones mayores desconocidas con un error claro.
- Los exit codes distinguen éxito, findings configurados para fallar, ejecución incompleta y error de invocación.
- El texto humano puede evolucionar; JSON, schemas, IDs, exit codes y semántica de configuración requieren compatibilidad o cambio mayor documentado.

## Convenciones

- Variables y funciones en `camelCase`, tipos en `PascalCase`, archivos y carpetas en `kebab-case`.
- Tests junto al módulo cuando sean unitarios; fixtures E2E bajo `fixtures/` con manifiesto propio.
- El core devuelve resultados tipados y no escribe directamente en `stdout`; la CLI y reporters controlan presentación.
- Las dependencias apuntan hacia contratos centrales; `core` no depende de `cli` ni de reporters.
- Toda entrada externa se valida: CLI, YAML/JSON, patterns, baseline y resultados anteriores.
- Los adaptadores ejecutan procesos mediante argumentos estructurados, nunca concatenando comandos en un shell, y tratan stdout no válido como provider error.
- La configuración de cada proveedor permanece separada y bajo control de su herramienta; Walkdown solo referencia su ubicación y opciones de ejecución.
- Los errores operativos incluyen código estable, causa y acción sugerida; no se silencian excepciones.
- Cancelación, timeout y señales del proceso deben cerrar navegador y escritores sin corromper el run.
- El código y los contratos usan inglés; la documentación principal puede ofrecer inglés y español en el futuro.
- No registrar secretos, valores completos de formularios, tokens, cookies ni cuerpos sensibles. Las evidencias se redactan antes de persistir.

## Interfaz visual

El MVP no tiene GUI. La salida de terminal debe:

- Funcionar con y sin color y respetar `NO_COLOR`.
- Mantener un modo no interactivo estable para CI.
- Mostrar primero veredicto y bloqueantes, luego evidencia y comandos de verificación.
- No depender de iconos para comunicar estado.

## Límites duros

- No requerir LLM, API key, cuenta ni conexión a un servicio de Walkdown para los checks deterministas.
- No afirmar que una aplicación es «segura» o «lista para producción» de forma absoluta.
- No ejecutar acciones destructivas o desconocidas sin permiso explícito y acotado.
- No almacenar secretos, cookies o datos sensibles sin redacción y consentimiento explícito.
- No enviar código, screenshots, traces o resultados a terceros por defecto.
- No basar un finding bloqueante únicamente en juicio de un LLM/VLM.
- No añadir una regla sin fixture roto, casos correctos y tests contra falsos positivos.
- No introducir cambios incompatibles en schemas, IDs o exit codes sin versionado y guía de migración.
- No instalar navegadores o modificar el proyecto inspeccionado de manera implícita.
- No descargar, instalar, actualizar o ejecutar un proveedor externo de forma implícita.
- No copiar, hacer fork o reimplementar Preflight como parte de Walkdown mientras el adaptador oficial satisfaga el contrato.
- No modificar `preflight.yml`, ejecutar `preflight ignore` ni convertir una supresión en una reparación sin decisión explícita del usuario.
- No subir `.env*`, sesiones autenticadas ni artefactos privados al repositorio.
