# 003 · Exploración segura y grafo de la aplicación — Plan

## Enfoque

Usar una cola determinista de breadth-first traversal para rutas y un inventario DOM/accessibility por página. Separar descubrimiento, clasificación de riesgo y ejecución en interfaces distintas. Una acción no puede ejecutarse si no existe una decisión de política explícita.

## Implementación

1. Definir `AppGraph`, `RouteNode`, `ElementRef`, `CandidateAction`, `RiskDecision` y `CoverageSummary`.
2. Implementar canonicalización de URL, control de origen, include/exclude y deduplicación.
3. Implementar cola BFS con presupuestos de páginas, profundidad, acciones, tiempo y repeticiones por patrón.
4. Extraer inventario combinando DOM, computed style y accessibility tree.
5. Implementar heurísticas deterministas de riesgo por tipo, método, texto, atributos, destino y contexto.
6. Ejecutar navegación segura y registrar transición o razón de omisión.
7. Detectar estados equivalentes con URL normalizada y firma DOM resumida para cortar loops.
8. Añadir fixtures de enlaces, SPA, parámetros infinitos, controles ambiguos y acciones destructivas cebadas.

## Decisiones

- **BFS determinista** — ofrece cobertura superficial útil antes que profundizar aleatoriamente y facilita reproducibilidad.
- **Deny by default para riesgo desconocido** — un falso negativo es preferible a causar un efecto irreversible.
- **DOM + accessibility + geometría** — ningún origen aislado describe bien todo lo que parece interactivo.
- **Cobertura explícita** — se descarta un PASS global cuando quedan rutas o acciones no observadas.
- **Política separada del crawler** — permite auditar decisiones y reutilizarla en journeys futuros.

## Riesgos

- **Heurísticas lingüísticas incompletas** — comenzar en inglés, permitir diccionario configurable y tratar desconocido como no ejecutable.
- **SPAs con estados sin URL** — usar firma de estado y mutaciones significativas, manteniendo presupuesto por ruta.
- **Explosión combinatoria** — límites independientes, canonicalización y detección de patrones repetidos.
- **Elementos que cambian durante el scan** — revalidar visibilidad y referencia inmediatamente antes de actuar.
