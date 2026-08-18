# 009 · Registro de patrones y corpus comunitario — Plan

## Enfoque

Separar metadata declarativa de implementación ejecutable. El manifiesto describe contrato y fixtures; las reglas complejas siguen siendo TypeScript revisado. El runner levanta cada app en puerto efímero, ejecuta configuración fija y compara findings esperados.

## Implementación

1. Definir JSON Schema de pattern, fixture manifest, expectativa y provenance.
2. Implementar loader local, validación de IDs/namespaces y compatibilidad de versión.
3. Crear testkit para servidor efímero, health check, aislamiento y cleanup.
4. Implementar commands `patterns validate` y `corpus run`.
5. Calcular precision, recall conocida, falsos positivos/negativos, duración y flakiness por repeticiones.
6. Migrar las reglas `004` y `005` al formato de corpus.
7. Añadir plantilla de contribución, checklist de privacidad/licencia y CI.
8. Publicar informe de benchmark como artifact, sin convertirlo en marketing engañoso.

## Decisiones

- **Declarativo para metadata, TypeScript para lógica** — evita un DSL insuficiente o peligroso.
- **Fixtures autocontenidos** — resultados reproducibles sin depender de sitios públicos cambiantes.
- **Métricas por regla y globales** — una media no debe ocultar una regla ruidosa.
- **No remote execution** — patterns externos no se cargan hasta diseñar un sandbox real.

## Riesgos

- **Fixtures irreales** — aceptar reproducciones minimizadas de casos reales con provenance y añadir apps combinadas.
- **Benchmark sobreajustado** — reservar casos de integración y revisar contribuciones que solo satisfacen el fixture nuevo.
- **Coste CI** — separar smoke por PR y corpus completo programado sin relajar gates críticos.
