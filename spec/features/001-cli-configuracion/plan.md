# 001 · Fundamentos del CLI y configuración — Plan

## Enfoque

Construir primero los tipos y schemas públicos y envolverlos con una capa CLI delgada. El core modela un run sin conocer stdout. Las escrituras usan archivo temporal y rename para que cancelaciones o crashes no dejen JSON válido a medias.

## Implementación

1. Inicializar workspace, TypeScript estricto, ESM, Biome, Vitest y scripts raíz.
2. Crear los contratos `Run`, `RunStatus`, `EffectiveConfig`, `ExitCode` y error tipado en `packages/core`.
3. Crear schema de configuración versionado, defaults conservadores, carga YAML y fusión de fuentes.
4. Implementar normalización de URL, rutas y viewports sin resolver todavía el target en navegador.
5. Implementar `RunStore` local con creación atómica, finalización, cancelación y redacción.
6. Implementar `walkdown scan`, ayuda, versión, `--print-config`, `--format` reservado y control de stdout/stderr.
7. Añadir handlers de señales y una única frontera de traducción de errores a exit code.
8. Añadir tests unitarios, snapshots estables del help y smoke multiplataforma.

## Decisiones

- **JSON versionado como contrato canónico** — la CLI humana será una vista; se descarta acoplar tipos al texto de consola.
- **Sin autoarranque de aplicaciones** — el target debe estar disponible; gestionar procesos del proyecto añade riesgos y variaciones de stack.
- **YAML para configuración humana y JSON Schema para tooling** — combina legibilidad con validación e integración de editores.
- **IDs de run aleatorios y ordenables** — no contienen datos del target ni información sensible.
- **stdout reservado al formato solicitado** — progreso y diagnóstico van a stderr para no romper pipes de agentes.

## Riesgos

- **Sobredefinir contratos prematuramente** — mantener el modelo mínimo y versionar lo público; los campos experimentales quedan fuera del schema estable.
- **Diferencias de filesystem** — probar separadores, rename y señales en los tres sistemas operativos.
- **Configuración insegura por defaults** — toda acción mutable queda desactivada hasta `003` y los defaults viven en un único módulo testeado.
