# 008 · GitHub Action y experiencia de pull request

**Estado:** propuesta

## Qué hace

Integra Walkdown en GitHub Actions para analizar una aplicación iniciada por el workflow, comparar con baseline, subir resultados/evidencias y presentar un resumen accionable en pull requests y checks.

## Por qué

El valor recurrente aparece cuando cada cambio se verifica antes de merge. GitHub también facilita distribución open-source, SARIF, artefactos y colaboración sin exigir un backend propio.

## Criterios de aceptación

- [ ] Existe una Action versionada que recibe target, config, baseline, timeout y política de fallo.
- [ ] La Action espera de forma acotada a que el target esté saludable y diferencia app no iniciada de findings.
- [ ] Ejecuta el CLI publicado, no una implementación divergente.
- [ ] Publica Job Summary con veredicto, delta, cobertura, bloqueantes y comandos locales de reproducción.
- [ ] Sube `results.json`, SARIF y artefactos permitidos incluso cuando el scan encuentra fallos.
- [ ] Publica SARIF en Code Scanning cuando el token/permisos lo permiten y degrada con mensaje claro cuando no.
- [ ] Por defecto bloquea solo findings `new/regressed` que alcanzan la severidad configurada.
- [ ] Los resultados persistentes aparecen en resumen sin impedir merge por defecto.
- [ ] Los datos de forks o PRs no confiables no reciben secrets ni permisos de escritura.
- [ ] La Action redacta URLs/artefactos sensibles y permite desactivar screenshots/traces.
- [ ] Se documentan ejemplos para app estática y servidor Node, caching de navegador y diagnóstico de timeout.
- [ ] El repositorio dogfoodea la Action contra las apps fixture.

## Fuera de alcance

- GitHub App, comentarios automáticos persistentes o comando `/walkdown fix`.
- Crear commits o PRs con arreglos.
- Iniciar cualquier stack automáticamente sin pasos declarados por el usuario.
- Soporte de otros proveedores CI en esta feature.
