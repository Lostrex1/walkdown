# 013 · Capa opcional de IA

**Estado:** propuesta

## Qué hace

Añade proveedores opcionales para explicar findings, agrupar causas probables, proponer journeys y revisar evidencia visual/semántica ambigua. Todo resultado de IA queda marcado como inferencia, conserva provenance y no reemplaza hechos deterministas.

## Por qué

Algunos defectos —contenido incoherente, jerarquía visual, resultado distinto de la intención— requieren contexto que las reglas no poseen. La IA puede aumentar cobertura y accesibilidad para principiantes si sus límites y falsos positivos son visibles.

## Criterios de aceptación

- [ ] Walkdown conserva toda funcionalidad determinista sin provider ni API key.
- [ ] La configuración de IA es opt-in e informa qué datos se enviarán antes de hacerlo.
- [ ] Screenshots, DOM, URLs o texto sensible pasan por redacción y allowlist de datos.
- [ ] Cada inference registra provider/model, versión de prompt, inputs referenciados, timestamp y coste/tokens si están disponibles.
- [ ] Un finding exclusivamente de IA se marca `inferred`, incluye confianza/razón y no bloquea por defecto.
- [ ] El usuario puede aceptar una inferencia como patrón/journey, pero esa decisión es explícita.
- [ ] La explicación para principiantes no altera hechos, severidad ni aceptación originales.
- [ ] Provider timeout/error degrada el análisis sin convertir un scan determinista exitoso en FAIL.
- [ ] Existe benchmark con bugs/controles y métricas de falsos positivos antes de habilitar cualquier check visual.
- [ ] Prompts e interfaces de provider son testeables y versionados.

## Fuera de alcance

- Entrenar o alojar modelos.
- Corrección automática de código.
- Ocultar qué información sale de la máquina.
- Presentar inferencias como garantía o hecho observado.
