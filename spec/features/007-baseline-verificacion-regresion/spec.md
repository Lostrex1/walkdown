# 007 · Baseline, verificación focalizada y regresión

**Estado:** hecho

## Qué hace

Permite aceptar deuda conocida en un baseline, comparar runs y ejecutar de nuevo únicamente la reproducción de un finding. Clasifica findings como nuevos, persistentes, corregidos o regresados y determina si una corrección está verificada.

Comandos objetivo:

```bash
walkdown baseline
walkdown verify <fingerprint>
walkdown regression
```

## Por qué

Sin comparación, Walkdown sería un informe puntual. Los agentes y CI necesitan una condición de parada objetiva y los proyectos existentes deben poder bloquear regresiones sin arreglar toda su deuda en una sola PR.

## Criterios de aceptación

- [x] `walkdown baseline` crea un archivo versionado con fingerprints, regla, scope y metadata suficiente para revisión.
- [x] El baseline no incluye secretos, paths absolutos, screenshots ni datos de sesión.
- [x] Un scan con baseline clasifica cada finding como `new` o `persistent` y reporta fingerprints ausentes como `fixed`.
- [x] Un finding previamente fijo que reaparece con el mismo fingerprint se clasifica `regressed`.
- [x] La política predeterminada puede fallar por `new/regressed` en severidades configuradas sin fallar por deuda `persistent`.
- [x] `verify <fingerprint>` reconstruye la mínima ruta/acción necesaria desde un resultado anterior y produce PASS, FAIL o INCONCLUSIVE.
- [x] La receta de verificación admite un executor identificado por provider; en el MVP solo se implementa Walkdown y los adaptadores posteriores pueden aportar el suyo sin cambiar el schema.
- [x] Verify no declara éxito si no pudo alcanzar el elemento/estado original.
- [x] `regression` ejecuta los checks relevantes y confirma que no aparecieron nuevos bloqueantes.
- [x] Suppressions requieren fingerprint/regla, razón y opcionalmente expiración; las expiradas vuelven a evaluarse.
- [x] Cambios de versión de regla que invaliden fingerprints se muestran como migración, no como cientos de fixes/news silenciosos.
- [x] La comparación es determinista y dispone de fixtures para cambios irrelevantes y relevantes.

## Fuera de alcance

- Modificar código o hacer commits.
- Resolver automáticamente conflictos de baseline.
- Almacenar historia en una base de datos o servicio.
- Verificación de journeys complejos, reservada a `011`.
