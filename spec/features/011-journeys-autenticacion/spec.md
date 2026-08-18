# 011 · Journeys y sesiones autenticadas

**Estado:** propuesta

## Qué hace

Permite declarar objetivos funcionales críticos en YAML y comprobarlos con pasos semánticos y aserciones observables. Puede reutilizar un `storageState` de prueba para explorar rutas autenticadas sin conocer credenciales.

Ejemplos: un visitante llega al registro; un usuario crea y vuelve a abrir un proyecto; logout impide volver a una página privada.

## Por qué

El crawling genérico encuentra defectos locales, pero no sabe qué resultado de negocio importa. Los journeys convierten intenciones confirmadas por el usuario en contratos persistentes de regresión.

## Criterios de aceptación

- [ ] Un journey declara ID, objetivo, prioridad, precondición, pasos, datos de prueba y aserciones mediante schema versionado.
- [ ] Los pasos usan roles, nombres accesibles y resultados semánticos; CSS queda como escape hatch explícito.
- [ ] Puede cargar `storageState` local sin copiar su contenido a resultados o artifacts.
- [ ] Credenciales y valores sensibles se referencian por variables de entorno y se redactan en logs.
- [ ] Cada paso captura evidencia y distingue fallo de aplicación, selector ambiguo, precondición ausente y harness error.
- [ ] Un journey puede ser blocking y participar en baseline/regression.
- [ ] Las acciones con side effects requieren allowlist y entorno/datos de prueba declarados.
- [ ] Cleanup se ejecuta cuando existe y su fallo se reporta por separado del resultado principal.
- [ ] Los journeys pueden ejecutarse individualmente y producir receta de reproducción.
- [ ] No se genera un journey automáticamente sin confirmación del usuario.

## Fuera de alcance

- Agente autónomo que inventa y ejecuta journeys sin revisión.
- Gestión de secretos o provisioning universal de cuentas.
- Sintaxis completa de Playwright disfrazada de YAML.
- Paralelización de journeys que comparten estado.
