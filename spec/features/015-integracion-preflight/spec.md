# 015 · Integración opcional con Preflight

**Estado:** propuesta — primera prioridad posterior al MVP

## Qué hace

Walkdown puede ejecutar el CLI oficial de Preflight como proveedor externo opcional, leer su salida JSON y combinar sus findings de launch-readiness con los findings de comportamiento runtime en un informe, baseline, política de CI y cola de reparación para agentes comunes.

La identidad permanece clara:

- `walkdown scan <url>` ejecuta exclusivamente el runtime QA nativo de Walkdown.
- `walkdown audit <url> --with preflight` ejecuta Walkdown y los proveedores configurados.
- Preflight conserva su configuración, versión, IDs, mensajes, licencia y autoría.

Configuración objetivo:

```yaml
providers:
  preflight:
    enabled: true
    command: preflight
    config: ./preflight.yml
    requiredVersion: ">=1.0.0 <2.0.0"
```

## Por qué

Preflight cubre código, configuración, variables de entorno, secretos, dependencias, SEO, archivos web, seguridad básica e integraciones. Walkdown cubre comportamiento observable en un navegador. Componer ambos ofrece un check de lanzamiento mucho más completo sin hacer que Walkdown mantenga decenas de checks ajenos a su diferenciación.

El valor propio de Walkdown no es agregar texto de dos herramientas, sino normalizar resultados como contratos verificables y ordenar un loop en el que cada provider vuelve a comprobar sus propios findings.

## Criterios de aceptación

- [ ] La integración se implementa únicamente después de completar y validar las features `001`–`008` del MVP.
- [ ] Preflight es opcional: `walkdown scan` funciona igual sin instalarlo, configurarlo o conectarse a ningún servicio.
- [ ] Walkdown busca un ejecutable local o una ruta explícita y nunca descarga, instala o actualiza Preflight automáticamente.
- [ ] Si está habilitado pero no existe, el resultado es `provider-unavailable` con instrucciones de instalación; no se presenta como PASS.
- [ ] El adaptador comprueba la versión de Preflight antes del scan y rechaza versiones incompatibles con `provider-incompatible`.
- [ ] Ejecuta el CLI oficial sin shell mediante argumentos equivalentes a `preflight scan <repo> --ci --format json` y con cwd/repo explícito.
- [ ] La salida JSON se valida antes de transformarse; JSON vacío, truncado o desconocido deja el audit incompleto y conserva diagnóstico redactado.
- [ ] Los exit codes documentados de Preflight se traducen sin perder semántica: pass, warnings, errors, invocation/provider error y cancelled.
- [ ] Cada finding normalizado contiene `provider: preflight`, versión, nativeId, adapterVersion, mensaje original, severidad mapeada, fingerprint namespaced y receta de verificación.
- [ ] El JSON original de Preflight puede conservarse como artifact redactado para diagnóstico y nunca reemplaza el `RunResult` canónico.
- [ ] `preflight.yml` continúa siendo la configuración autoritativa de Preflight; Walkdown puede referenciarla pero no modificarla.
- [ ] Walkdown no ejecuta `preflight ignore`, no añade allowlists y no considera una supresión como fix.
- [ ] Un finding de Preflight se verifica invocando al provider original, preferentemente con `preflight scan --only <nativeId> --ci --format json` cuando la versión lo soporte.
- [ ] El agente recibe una cola común ordenada por severidad, confianza, dependencia y coste, pero cada work item conserva provider y verificación propios.
- [ ] Tras resolver un finding de cualquier provider se ejecuta su verificación y después la regresión configurada de Walkdown/otros providers antes de marcarlo fixed.
- [ ] El audit muestra secciones separadas «Launch readiness · Preflight» y «Runtime behavior · Walkdown», además de un veredicto combinado.
- [ ] Findings potencialmente relacionados entre providers pueden enlazarse, pero nunca se fusionan o deduplican silenciosamente.
- [ ] Un fallo o cancelación de Preflight marca solo ese provider como incompleto y el veredicto global indica audit incompleto; los resultados válidos de Walkdown se conservan.
- [ ] Baselines y suppressions incluyen provider/version; un cambio de schema, versión o fingerprint se trata como migración explícita.
- [ ] La GitHub Action permite activar Preflight, fija/recomienda una versión reproducible y publica sus resultados mediante el mismo summary/artifacts sin hacerlo obligatorio.
- [ ] La documentación atribuye Preflight.sh, enlaza su repositorio/licencia MIT y evita lenguaje que sugiera propiedad, respaldo oficial o rebranding sin acuerdo de sus maintainers.
- [ ] El adaptador tiene golden fixtures de versiones soportadas, tests de exit codes, malformed output, ausencia del binario, cancelación y compatibilidad multiplataforma.

## Fuera de alcance

- Copiar, vendorizar, hacer fork o modificar el código fuente de Preflight dentro de Walkdown.
- Incluir el binario de Preflight en el paquete o convertirlo en dependencia obligatoria.
- Reimplementar sus checks de SEO, secretos, dependencias, configuración o servicios.
- Fusionar `walkdown.config.yaml` y `preflight.yml` en una configuración propietaria.
- Publicar resultados en el dashboard de Preflight o usar sus funciones alojadas sin configuración explícita del usuario.
- Prometer compatibilidad con cualquier versión futura de Preflight.
- Crear un marketplace genérico de providers en esta feature.
