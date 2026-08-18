# 014 · Runtime safety checks — Plan

## Enfoque

Separar reglas pasivas, que reutilizan evidencia ya capturada, de probes activos que requieren journeys, identidades ficticias y allowlist. Aplicar data minimization: detectar en memoria, persistir únicamente fingerprints y fragmentos redactados.

## Implementación

1. Definir metadata adicional `SafetyFinding`, scope, limitation y tipo passive/active.
2. Implementar detector de cookies candidatas y evaluación contextual de flags.
3. Implementar detectores de tokens/datos sensibles con redacción irreversible antes de artifact writer.
4. Implementar reglas de internal-detail leakage sobre errores y responses visibles.
5. Integrar probe de logout con journeys y contextos limpios.
6. Implementar comparación de account-enumeration solo con identidades/configuración autorizadas.
7. Implementar double-action probe exclusivamente sobre fixtures/allowlist con correlación de requests.
8. Crear threat model del propio scanner, fixtures y revisión de que los resultados no contienen los secretos detectados.

## Decisiones

- **Pasivo por defecto, activo opt-in** — reduce riesgo sobre aplicaciones reales.
- **No persistir el secreto hallado** — un hash/fingerprint y ubicación redactada bastan para reparar.
- **Findings con limitaciones obligatorias** — evita convertir una observación parcial en conclusión global.
- **Sin probes de autorización horizontal automáticos** — intentar IDs ajenos excede la misión y puede causar acceso indebido.

## Riesgos

- **El scanner filtra lo que detecta** — redacción in-memory, tests canary y revisión de artifacts completos.
- **Confundir claves públicas con secretos** — patrones por contexto, allowlist documentada y severidad/confianza conservadoras.
- **Probes activos dañinos** — entorno no productivo, autorización granular, fixtures y budgets de una sola operación.
