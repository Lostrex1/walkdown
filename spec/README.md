# Walkdown — Spec Driven Development

Esta carpeta es la fuente de verdad del proyecto. Walkdown se desarrolla mediante especificaciones: primero se define el comportamiento esperado, después el plan técnico, luego las tareas y solo entonces se implementa.

## Estructura

```text
spec/
├── constitution/
│   ├── mission.md
│   ├── tech-stack.md
│   └── roadmap.md
└── features/
    └── NNN-nombre-feature/
        ├── spec.md
        ├── plan.md
        └── tasks.md
```

La constitución contiene decisiones estables. Cada feature debe respetarla. Si una propuesta entra en conflicto con ella, se replantea la propuesta o se modifica la constitución de forma explícita y justificada antes de continuar.

## Flujo de trabajo

1. Elegir la siguiente feature de `constitution/roadmap.md`.
2. Revisar y actualizar su `spec.md` hasta que los criterios sean inequívocos.
3. Revisar `plan.md` y registrar cualquier decisión técnica nueva.
4. Ejecutar en orden la checklist de `tasks.md`.
5. Validar build, tipos, lint, tests y criterios de aceptación.
6. Marcar la feature como implementada y moverla a «Hecho» en el roadmap.

## Definición global de terminado

Una feature solo está terminada cuando:

- Todos sus criterios de aceptación están comprobados y marcados.
- Tiene tests proporcionales al riesgo, incluidos casos negativos cuando aplique.
- No rompe los contratos públicos de CLI, configuración o resultados.
- No introduce interacciones de navegador fuera de la política de seguridad.
- La documentación de usuario y de contribución está actualizada.
- `npm run check` y `npm test` terminan correctamente.

## Estados

- **Propuesta:** definida pero todavía no comprometida para implementación inmediata.
- **Siguiente:** primera feature pendiente que debe abordarse.
- **En curso:** implementación activa; solo debe haber una salvo trabajo deliberadamente paralelo.
- **Implementado:** validada y movida a «Hecho».

Las features `001`–`008` componen el MVP. Las features `009`–`015` documentan la evolución prevista, pero no deben ampliar el MVP accidentalmente. La integración con Preflight (`015`) es la primera prioridad posterior al MVP aunque su número sea posterior, porque fue especificada después de las demás features.
