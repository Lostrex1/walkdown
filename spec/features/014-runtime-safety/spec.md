# 014 · Runtime safety checks

**Estado:** propuesta

## Qué hace

Añade un conjunto acotado de comprobaciones de seguridad observable desde el navegador: flags de cookies, tokens o datos sensibles expuestos, detalles internos en errores, comportamiento tras logout, enumeración de cuentas y repetición accidental de operaciones críticas.

Los resultados se denominan **runtime safety findings** y nunca certifican que la aplicación sea segura.

## Por qué

Las aplicaciones generadas con IA suelen implementar autenticación visible sin comprobar autorización, sesión o exposición en cliente. Walkdown puede encontrar señales de alto valor desde el runtime, siempre que comunique con precisión lo que observó y lo que no puede demostrar.

## Criterios de aceptación

- [ ] Las reglas pasivas inspeccionan cookies accesibles, storage, URLs, DOM, consola y errores con redacción previa a persistencia.
- [ ] Detecta cookies de sesión observadas sin los flags esperados según contexto HTTP/HTTPS, sin asumir que toda cookie es de sesión.
- [ ] Detecta patrones de tokens/secretos de alta confianza en URL, DOM, consola o storage y guarda solo versión redactada/hash seguro.
- [ ] Detecta stack traces, nombres de tablas, queries u otros detalles internos en respuestas/errores visibles.
- [ ] Un journey explícito de logout puede comprobar que una vista privada no sigue accesible mediante navegación atrás/refresh.
- [ ] La prueba de enumeración de cuentas usa identidades ficticias autorizadas y compara respuestas sin enviar datos reales.
- [ ] La repetición de acción crítica solo se prueba en entorno y endpoint allowlisted, con cleanup o fixture.
- [ ] Cada finding enumera alcance y limitaciones: cliente observado, rutas probadas y ausencia de garantía sobre endpoints no visitados.
- [ ] Las reglas activas están desactivadas por defecto y nunca se ejecutan contra producción sin opt-in explícito.
- [ ] Cada regla tiene revisión de seguridad, fixtures y casos negativos para evitar exposición o alarmas falsas.

## Fuera de alcance

- Penetration testing, fuzzing ofensivo o explotación.
- SAST, SCA, secret scanning del repositorio o auditoría de infraestructura.
- Certificación de auth, autorización, RLS o cumplimiento normativo.
- Probar IDs ajenos, extraer datos de otros usuarios o evadir controles.
