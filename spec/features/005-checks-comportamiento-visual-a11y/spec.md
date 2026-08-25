# 005 · Checks de interacción, responsive y accesibilidad funcional

**Estado:** implementado

## Qué hace

Walkdown prueba controles seguros y compara el estado antes/después para descubrir botones o elementos clicables sin efecto observable. También inspecciona desktop y móvil para detectar overflow horizontal, controles tapados o fuera del viewport y problemas básicos de interacción por teclado y nombre accesible.

## Por qué

Es la diferenciación principal frente a checklists y análisis estáticos: comprobar que lo que parece utilizable produce un resultado y sigue siendo operable en condiciones reales.

## Criterios de aceptación

- [x] Para cada control seguro probado se captura un estado antes/después y una ventana de asentamiento acotada.
- [x] Se considera efecto observable: navegación, mutación DOM significativa, request iniciada, dialog, download, popup, cambio de foco significativo o feedback accesible.
- [x] `interaction.dead-control` solo se emite cuando no ocurre ningún efecto permitido y la acción fue ejecutada con éxito técnico.
- [x] Los controles ambiguos, inestables o no reidentificables producen `inconclusive`, no un fallo.
- [x] Se detectan elementos que parecen clicables por rol, handler o estilo pero carecen de semántica/acción funcional.
- [x] Se detecta overflow horizontal de página y se identifica el elemento que lo causa cuando sea posible.
- [x] Se detectan controles visibles cuyo punto accionable está cubierto, fuera de viewport o no puede recibir interacción.
- [x] Los checks se ejecutan al menos en presets desktop y mobile configurables.
- [x] Se detectan controles sin nombre accesible y una navegación básica por teclado que pierde foco, queda atrapada o no alcanza controles esenciales.
- [x] Un modal fixture comprueba entrada, contención razonable y devolución de foco sin exigir una única implementación.
- [x] Animaciones, polling, analytics, timestamps y cambios irrelevantes no cuentan como mutación significativa.
- [x] Cada heurística incluye controles negativos para reducir falsos positivos.

## Fuera de alcance

- Auditoría WCAG completa o reemplazo de axe.
- Evaluación estética mediante IA.
- Pixel-perfect screenshot diff.
- Envío de formularios o acciones no seguras.
- Afirmar intención de negocio cuando no existe efecto observable.
