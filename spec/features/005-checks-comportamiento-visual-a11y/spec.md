# 005 · Checks de interacción, responsive y accesibilidad funcional

**Estado:** propuesta

## Qué hace

Walkdown prueba controles seguros y compara el estado antes/después para descubrir botones o elementos clicables sin efecto observable. También inspecciona desktop y móvil para detectar overflow horizontal, controles tapados o fuera del viewport y problemas básicos de interacción por teclado y nombre accesible.

## Por qué

Es la diferenciación principal frente a checklists y análisis estáticos: comprobar que lo que parece utilizable produce un resultado y sigue siendo operable en condiciones reales.

## Criterios de aceptación

- [ ] Para cada control seguro probado se captura un estado antes/después y una ventana de asentamiento acotada.
- [ ] Se considera efecto observable: navegación, mutación DOM significativa, request iniciada, dialog, download, popup, cambio de foco significativo o feedback accesible.
- [ ] `interaction.dead-control` solo se emite cuando no ocurre ningún efecto permitido y la acción fue ejecutada con éxito técnico.
- [ ] Los controles ambiguos, inestables o no reidentificables producen `inconclusive`, no un fallo.
- [ ] Se detectan elementos que parecen clicables por rol, handler o estilo pero carecen de semántica/acción funcional.
- [ ] Se detecta overflow horizontal de página y se identifica el elemento que lo causa cuando sea posible.
- [ ] Se detectan controles visibles cuyo punto accionable está cubierto, fuera de viewport o no puede recibir interacción.
- [ ] Los checks se ejecutan al menos en presets desktop y mobile configurables.
- [ ] Se detectan controles sin nombre accesible y una navegación básica por teclado que pierde foco, queda atrapada o no alcanza controles esenciales.
- [ ] Un modal fixture comprueba entrada, contención razonable y devolución de foco sin exigir una única implementación.
- [ ] Animaciones, polling, analytics, timestamps y cambios irrelevantes no cuentan como mutación significativa.
- [ ] Cada heurística incluye controles negativos para reducir falsos positivos.

## Fuera de alcance

- Auditoría WCAG completa o reemplazo de axe.
- Evaluación estética mediante IA.
- Pixel-perfect screenshot diff.
- Envío de formularios o acciones no seguras.
- Afirmar intención de negocio cuando no existe efecto observable.
