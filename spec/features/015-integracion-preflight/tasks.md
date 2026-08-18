# 015 · Integración opcional con Preflight — Tareas

- [ ] Confirmar que el MVP `001`–`008` está implementado y estable antes de comenzar.
- [ ] Abrir conversación upstream y revisar licencia, naming y contrato JSON vigente.
- [ ] Definir matriz de versiones/capabilities soportadas.
- [ ] Definir interfaces de provider, source, error y verification executor.
- [ ] Implementar resolver local y diagnóstico sin auto-install.
- [ ] Implementar detección de versión y capabilities.
- [ ] Implementar process runner sin shell, timeout y cancelación.
- [ ] Implementar validator/parser por versión del JSON de Preflight.
- [ ] Mapear todos los exit codes sin confundir provider error con PASS.
- [ ] Normalizar findings conservando provider, versión, nativeId y mensaje.
- [ ] Persistir raw artifact redactado y límites de salida.
- [ ] Implementar `walkdown audit` y veredicto combinado.
- [ ] Implementar reportes agrupados y relaciones no destructivas.
- [ ] Integrar baseline, suppressions y migraciones por provider/version.
- [ ] Implementar verificación focalizada mediante Preflight.
- [ ] Integrar work items y regresión multi-provider en el loop de agentes.
- [ ] Extender GitHub Action con activación opcional y version pin.
- [ ] Añadir attribution, licencia y documentación de instalación/configuración.
- [ ] Crear golden fixtures y tests de ausencia, incompatibilidad, output inválido y cancelación.
- [ ] Ejecutar tests multiplataforma y una demo completa Preflight + Walkdown → agent → verify → regression.
- [ ] Validar todos los criterios de `spec.md`.
- [ ] Mover la feature a «Hecho» en `../../constitution/roadmap.md`.

## Mantenimiento

- [ ] Para cada release soportada de Preflight, actualizar golden fixtures y ejecutar la matriz completa antes de ampliar el rango de versiones.
- [ ] Revisar periódicamente licencia, CLI, JSON, exit codes y naming upstream; no asumir compatibilidad por semver sin pruebas.
