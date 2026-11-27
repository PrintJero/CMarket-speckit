## Qué

<!-- Qué cambia este PR, en 1–3 frases. -->

## Por qué

<!-- El problema o requisito que resuelve. -->

## Cómo se probó

<!-- Comandos ejecutados y resultado. Ej.: npm run typecheck / lint / test:unit / build / test:e2e -->

## Spec relacionada

<!-- specs/###-nombre (o "n/a" para chore/fix fuera de una feature). Closes #… si aplica. -->

## Checklist de la constitución (`.specify/memory/constitution.md`)

- [ ] **Aislamiento entre comunidades (Principio II):** ninguna consulta, ruta o respuesta expone datos de otra comunidad.
- [ ] **Gating de datos de contacto (Principio VI):** no se revela contacto fuera de los flujos permitidos.
- [ ] **Flujos críticos (Principio VIII):** si toca registro, membresía, listings, transacciones o administración MASTER, los tests se escribieron antes, fallaron primero y ahora están en verde.
- [ ] **Sin secretos:** ningún `.env*`, token ni credencial en el diff; nada de `NEXT_PUBLIC_` en `CLOUDINARY_*`, `NEXTAUTH_SECRET` o `CLEANUP_TOKEN`.
- [ ] **Sin switches de test:** `OPERATOR_PANEL_ENABLED`, `GOOGLE_OAUTH_MOCK_*`, `EMAIL_TEST_CAPTURE` y `CLOUDINARY_TEST_STUB` no se activan fuera de tests.
- [ ] **Sin atajos de CI:** sin `@ts-ignore`, `as any`, `eslint-disable`, `.skip`/`.only` ni timeouts inflados (o justificado abajo).
- [ ] **Migraciones:** cambios de schema solo con una migración nueva (`prisma migrate dev`); ninguna migración aplicada fue editada.
