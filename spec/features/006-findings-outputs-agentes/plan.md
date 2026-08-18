# 006 · Findings, artefactos y outputs agent-native — Plan

## Enfoque

Crear un ensamblador de findings que valida invariantes y reporters puros que solo consumen `RunResult`. Publicar JSON Schema como artefacto del paquete y probar las representaciones con fixtures golden semánticos.

## Implementación

1. Finalizar `Finding`, `FindingSource`, `RepairContract`, `VerificationRecipe`, `Coverage` y `RunResult` v1.
2. Implementar ensamblador que añade metadata, valida evidencias y calcula veredicto/exit policy.
3. Implementar JSON y schema, orden de campos estable y redacción final defensiva.
4. Implementar stream JSONL con eventos run-start, finding, coverage y run-end.
5. Implementar reporter terminal para TTY/no-TTY y modo verbose.
6. Implementar reporter Markdown con paths portables.
7. Implementar SARIF 2.1.0 y validarlo con schema oficial incluido en tests.
8. Implementar vista `--format agent` con instrucciones y referencia al JSON.
9. Añadir golden fixtures, compatibility tests y documentación de consumo.

## Decisiones

- **RunResult inmutable** — todos los reporters ven exactamente los mismos hechos.
- **JSON Schema publicado** — agentes y herramientas pueden validar sin importar paquetes TypeScript.
- **SARIF conservador** — no inventar archivos/líneas evita anotaciones engañosas.
- **Confianza no modifica severidad automáticamente** — son dimensiones distintas; la política decide bloqueo.
- **Prompt derivado, no canónico** — el lenguaje natural puede evolucionar sin romper automatizaciones.
- **Procedencia obligatoria** — el modelo se prepara para proveedores futuros, pero Walkdown no implementa ni depende de ellos dentro del MVP.

## Riesgos

- **Schema demasiado grande** — mantener referencias reutilizables y ejemplos mínimos/completos.
- **Golden tests frágiles** — normalizar IDs/timestamps y comprobar semántica donde el orden no sea contrato.
- **Filtración en reporter** — redacción en captura y una segunda barrera antes de serializar.
- **SARIF sin source location** — usar URI de la ruta web y artifacts como propiedades hasta que exista mapeo confiable a código.
