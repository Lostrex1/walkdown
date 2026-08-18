# 006 · Findings, artefactos y outputs agent-native

**Estado:** propuesta

## Qué hace

Convierte los resultados de reglas en findings autocontenidos y exporta un mismo run como terminal, JSON, JSONL, Markdown y SARIF. Cada finding comunica hechos, inferencia, reparación, restricciones, aceptación, evidencia y comando de verificación.

## Por qué

El usuario principal puede ser humano o agente. Un texto agradable no basta para automatizar y un JSON opaco no ayuda a un principiante. Un modelo canónico compartido permite ambas experiencias sin divergencia.

## Criterios de aceptación

- [ ] El JSON v1 contiene `schemaVersion`, run, target, configuración relevante, cobertura, resumen y findings.
- [ ] Cada finding contiene ID de regla, fingerprint, estado, severidad, confianza, ruta, ElementRef si aplica, acción, observaciones, evidencia, expected outcome y verificación.
- [ ] El contrato admite `FindingSource` con provider, providerVersion, nativeId y adapterVersion sin obligar al MVP a ejecutar proveedores externos.
- [ ] Los findings nativos declaran `provider: walkdown`; los externos conservan namespace, mensaje y procedencia originales y nunca aparentan haber sido detectados por Walkdown.
- [ ] Los campos `facts`, `inference` y `repair` están separados y una recomendación nunca se presenta como observación.
- [ ] `repair` incluye objetivo, restricciones y criterios de aceptación accionables sin exigir un framework concreto cuando se desconoce.
- [ ] Todas las rutas de evidencia son relativas, existen o se marcan como omitidas/truncadas con razón.
- [ ] JSONL puede consumirse incrementalmente y termina con un evento de resumen.
- [ ] La salida terminal muestra veredicto, bloqueantes, cobertura y siguientes comandos; respeta `NO_COLOR`.
- [ ] Markdown produce un informe portable con enlaces relativos a artefactos.
- [ ] SARIF 2.1.0 valida y publica reglas/resultados; solo añade localización de código cuando exista evidencia real, no adivinada.
- [ ] Los formats no cambian exit code ni semántica del run.
- [ ] Hay fixtures golden y validación contra JSON Schema para todos los outputs machine-readable.
- [ ] Un prompt para agente se genera como vista derivada y nunca sustituye el JSON canónico.

## Fuera de alcance

- Encontrar automáticamente el archivo/línea causante.
- Enviar resultados a GitHub o servicios externos.
- Generar o aplicar parches de código.
- Traducir informes a múltiples idiomas en el MVP.
