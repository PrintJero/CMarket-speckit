# Reporte de cierre: CMarket v1.0.0

**Fecha:** 27 de noviembre de 2026
**Repositorio:** [PrintJero/CMarket-speckit](https://github.com/PrintJero/CMarket-speckit)
**Release:** [v1.0.0](https://github.com/PrintJero/CMarket-speckit/releases/tag/v1.0.0) (tag sobre `5b651cb`), seguida del hotfix [v1.0.1](https://github.com/PrintJero/CMarket-speckit/releases/tag/v1.0.1) (tag sobre `63cb92e`), que es la versión en producción
**Constitución:** v4.1.1
**Participantes:**

- **Jero** (Product Owner, Scrum Master y desarrollador): decisiones de producto y de secretos, preparación del entorno local (Node 24, GitHub CLI) y, más adelante, accesos a producción.
- **Claude Code** (asistente de ingeniería): diagnóstico, correcciones, flujo Spec Kit de la spec 018, CI/CD, release y documentación.

Las specs 002 a 017 se desarrollaron antes de este cierre; su autoría consta en el historial de git.

---

## 1. Resumen ejecutivo

CMarket v1.0.0 queda **cerrado, probado y publicado como release**. Las cinco quality gates pasan en local y en el CI de GitHub:

- typecheck y lint con 0 errores;
- 382/382 pruebas unitarias y de contrato;
- build de producción;
- 123/123 pruebas end-to-end en tres corridas seguidas.

Se adoptó gitflow con ramas protegidas. Se completó la spec 018 (PWA instalable), que era el único principio de la constitución sin cumplir. Al estabilizar las pruebas aparecieron **dos bugs reales de producto**, ambos corregidos con prueba de regresión. El más grave renombraba cuentas ajenas entre comunidades.

**Producción está desplegada y funcionando** en Dokploy (sección 8). El smoke test automatizado pasó 9/9 contra la URL de producción, y Jero verificó a mano el registro con correo real, la verificación por Resend y el inicio de sesión con Google. Quedan el bootstrap de datos, las tareas programadas y los backups automáticos (secciones 8 y 11).

---

## 2. Punto de partida (diagnóstico del 27/11/2026)

| Área          | Estado inicial                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Ramas         | Solo `main`, más 11 ramas locales con nombres inconsistentes. No existía `develop`.                                      |
| Lint          | 2 errores (`react-hooks/immutability` en `AppShell.tsx` y `CommunitySelector.tsx`)                                       |
| Typecheck     | 0 errores con el cliente de Prisma generado                                                                              |
| Unit/contract | 357/382. Los 25 fallos se debían a variables dummy de Cloudinary que faltaban en `.env.test` (entorno, no código).       |
| E2E           | 89 aprobados y 19 fallidos: 12 deterministas (pruebas desalineadas con el rediseño de UI) y 7 intermitentes (`next dev`) |
| Deuda         | 2 `eslint-disable` sin justificar; 3 casillas abiertas en la spec 011                                                    |
| `npm audit`   | 4 críticas, 8 altas y 2 moderadas                                                                                        |
| Constitución  | Principio V (PWA instalable) incumplido; referencia rota a una "spec 001" que no existe                                  |
| Entorno       | Node 22 en lugar de 24, Docker apagado, GitHub CLI sin instalar                                                          |

---

## 3. Errores corregidos

| Archivo                                                                 | Error                                                                                                    | Causa raíz                                                                                                         | Solución                                                                                                                       | Commit               |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| `app/_components/AppShell.tsx`, `CommunitySelector.tsx`                 | Lint `react-hooks/immutability`                                                                          | Asignación a `window.location.href`                                                                                | `window.location.assign()`, conservando la navegación completa (Principio II)                                                  | `231375c`            |
| `app/communities/[communityId]/listings/ListingMediaUploader.tsx`       | 2 `eslint-disable` sin justificar                                                                        | Efecto de "siembra" en el montaje y `onChange` fuera de las dependencias                                           | Inicializador perezoso de estado y ref con el último `onChange`                                                                | `46bad56`            |
| `src/lib/auth/authConfig.ts`                                            | **Bug de producto:** el registro con Google renombraba **todas** las cuentas sin nombre de la plataforma | NextAuth v4 no pasa `account.userId` a los eventos, y Prisma ignora un campo `undefined` en el `where`             | Filtrar por `user.id` con una guarda; el adaptador rechaza escrituras sin `userId`. Prueba de regresión escrita primero (rojo) | `6d9251e`            |
| `app/_components/AcceptRejectButtons.tsx` y la página de transacción    | **Bug de producto:** el modal de calificación tras aceptar podía cerrarse solo                           | Un `router.refresh()` de `AppShell` re-renderizaba la página como `ACCEPTED` y desmontaba el componente            | Se mantiene montado de `PENDING` a `ACCEPTED` (prop `pending`). Prueba de regresión determinista                               | `582313b`            |
| `app/master/_components/MasterConfirmDialog.tsx`                        | Accesibilidad: el campo "Type DELETE to confirm" no tenía label asociado                                 | `<label>` sin `htmlFor`                                                                                            | `useId()`                                                                                                                      | `5c46fc0`            |
| Pruebas e2e de MASTER (9 tests)                                         | Fallos deterministas                                                                                     | El rediseño del panel (`62f184b`) cambió los diálogos, las pestañas y los textos, y las pruebas no se actualizaron | Helpers `confirmMasterDialog` y `expectMasterPageStatus`. Las aserciones de comportamiento no cambian                          | `cdc2500`            |
| `test_listing_display_names`, `test_purchase_flow`                      | Strict-mode                                                                                              | El shell de navegación (015) duplicó textos                                                                        | Locators acotados a `<main>` y `exact`                                                                                         | `8d8be83`            |
| `playwright.config.ts`                                                  | 7 pruebas intermitentes                                                                                  | `next dev` compila cada ruta en la primera petición y supera los 30 s en frío                                      | La suite corre contra la build de producción (`next start`), de ~2.5 min a ~40 s, sin subir timeouts ni retries                | `c44f785`            |
| `test_signup_display_name`, `test_listing_creation_display_name_prompt` | Intermitencia                                                                                            | La verificación de correo es un `fetch` en el cliente y la prueba navegaba antes de que terminara                  | Esperar "Your email is verified."                                                                                              | `4a147c5`            |
| `test_pwa_installable` (018)                                            | Intermitencia en CI (`ERR_ABORTED`)                                                                      | Peticiones en vuelo (sincronización de comunidad activa, RSC) al cortar la red                                     | Fijar la comunidad activa en el fixture y esperar `networkidle`                                                                | `077292e`            |
| `.gitattributes`, `Dockerfile`                                          | **Bug de despliegue:** el contenedor se reiniciaba en bucle si la imagen se construía desde Windows      | `docker-entrypoint.sh` con CRLF (`#!/bin/sh\r`)                                                                    | `eol=lf` en git y normalización en el Dockerfile                                                                               | `9149d7f`, `1ec83cb` |
| `Dockerfile`                                                            | **Bug de despliegue:** los recursos de la PWA darían 404 en producción                                   | El output `standalone` no incluye `public/`                                                                        | `COPY public/` en la etapa runner                                                                                              | `bd53e17`            |
| `package.json`                                                          | 4 vulnerabilidades críticas                                                                              | `next` 16.2.10, `next-auth` 4.24.14 y `@auth/prisma-adapter` sin uso                                               | `next` 16.4.6, `next-auth` 4.24.15 y se elimina el adaptador. Quedan 0 críticas                                                | `714531b`            |

---

## 4. Pruebas

| Suite                                               | Resultado final                                                                                     |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Unit + contract (Vitest)                            | **382 aprobadas, 0 fallidas, 0 omitidas** (42 archivos)                                             |
| End-to-end (Playwright, build de producción)        | **123 aprobadas, 0 fallidas, 0 omitidas**                                                           |
| 3 corridas e2e consecutivas sobre la release        | 123/123 · 123/123 · 123/123 (39.6 s, 37.0 s, 36.7 s)                                                |
| CI de GitHub sobre la release (push y pull_request) | `verify` y `docker` en verde                                                                        |
| Docker local (`--profile app --build`)              | `healthy`, `[entrypoint] migrations up to date; starting server`, `/api/health` → `{"status":"ok"}` |

Las e2e pasaron de 108 a 123 (108 + 11 + 2 + 2):

- 11 pruebas nuevas en la spec 018 (`test_pwa_installable`): manifest, íconos, metadatos, headers y registro del worker, instalabilidad con el motor de Chrome, allowlist de caché, limpieza de cachés viejas, modo offline, frescura y ausencia de datos personales;
- 2 de viewports móviles (iPhone 13 y Pixel 7);
- 2 de regresión de los bugs de producto (nombres de Google y modal de calificación).

**Intermitencia:** de 18 corridas completas durante el cierre, las que fallaron de forma intermitente tuvieron siempre una causa identificada y corregida (sección 3). No se usó `.skip`, `.only`, `retries` ni se subieron timeouts.

---

## 5. Pull requests mergeados

Todos se mergearon con _merge commit_, con el CI en verde.

| PR                                                          | Origen → destino                         | Propósito                                                                                                                            |
| ----------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| [#25](https://github.com/PrintJero/CMarket-speckit/pull/25) | `fix/quality-gates` → `develop`          | Lint, refactor del uploader, 2 bugs de producto, pruebas de MASTER y e2e contra la build de producción                               |
| [#26](https://github.com/PrintJero/CMarket-speckit/pull/26) | `chore/gitflow-ci` → `develop`           | Triggers de gitflow, gates de format/build/docker, plantilla de PR, LF y Prettier                                                    |
| [#27](https://github.com/PrintJero/CMarket-speckit/pull/27) | `fix/docker-entrypoint-crlf` → `develop` | Entrypoint con CRLF en la imagen                                                                                                     |
| [#28](https://github.com/PrintJero/CMarket-speckit/pull/28) | `fix/deps` → `develop`                   | Vulnerabilidades críticas                                                                                                            |
| [#29](https://github.com/PrintJero/CMarket-speckit/pull/29) | `test/011-verification` → `develop`      | Cierre de las 3 casillas de la spec 011                                                                                              |
| [#30](https://github.com/PrintJero/CMarket-speckit/pull/30) | `docs/backlog` → `develop`               | `specs/BACKLOG.md` y constitución 4.1.1                                                                                              |
| [#31](https://github.com/PrintJero/CMarket-speckit/pull/31) | `018-pwa-installable` → `develop`        | Spec 018: PWA instalable                                                                                                             |
| [#32](https://github.com/PrintJero/CMarket-speckit/pull/32) | `chore/deploy-workflow` → `develop`      | Deploy a GHCR + webhook de Dokploy, imagen `tools`, smoke test y runbook                                                             |
| [#33](https://github.com/PrintJero/CMarket-speckit/pull/33) | `release/v1.0.0` → `main`                | Release v1.0.0                                                                                                                       |
| [#34](https://github.com/PrintJero/CMarket-speckit/pull/34) | `main` → `develop`                       | Back-merge posterior a la release                                                                                                    |
| [#35](https://github.com/PrintJero/CMarket-speckit/pull/35) | `docs/release-v1.0.0-report` → `develop` | Este reporte                                                                                                                         |
| [#36](https://github.com/PrintJero/CMarket-speckit/pull/36) | `chore/cd-pipeline` → `develop`          | CD solo por imagen: `metadata-action`, `latest` solo en `main`, `workflow_dispatch`, webhook con 200 estricto, health check de 5 min |
| [#37](https://github.com/PrintJero/CMarket-speckit/pull/37) | `docs/production-runbook` → `develop`    | Runbook del setup real de Dokploy, bootstrap, schedules, smoke en producción y backlog (OAuth, backups)                              |
| [#38](https://github.com/PrintJero/CMarket-speckit/pull/38) | `hotfix/email-error-detail` → `main`     | Hotfix v1.0.1 (errores de correo diagnosticables, error claro y reintentable)                                                        |
| [#39](https://github.com/PrintJero/CMarket-speckit/pull/39) | `main` → `develop`                       | Back-merge posterior al hotfix                                                                                                       |

---

## 6. Gitflow

**Modelo:**

- `main` (producción, protegida, solo recibe `release/*` y `hotfix/*` con tag);
- `develop` (integración, protegida, rama por defecto);
- ramas `###-nombre`, `fix/*`, `chore/*`, `test/*` y `docs/*` hacia `develop`.

**Protección de `main` y `develop`:** PR obligatorio, checks `verify` y `docker` obligatorios, sin force-push ni borrado, y las reglas también aplican a administradores.

**Estado final:**

- `develop` está sincronizada con `main`;
- no quedan PRs abiertos;
- en remoto solo existen `main` y `develop`;
- las 11 ramas locales viejas se borraron, tras verificar que estaban mergeadas.

`git log --oneline --graph --decorate -40` sobre `main`, recortado a la release:

```text
*   5b651cb (tag: v1.0.0, origin/main, main) Merge pull request #33 from PrintJero/release/v1.0.0
|\
| * 077292e test(018): remove in-flight requests before the offline navigation test
| * a8d899d chore(release): v1.0.0
| *   73cf9d8 Merge pull request #32 from PrintJero/chore/deploy-workflow
| |\
| | * 457ff2b docs: production deployment runbook (Dokploy)
| | * ecf161c test(smoke): credential-free production smoke suite (npm run test:smoke)
| | * ba9bf6c chore(deploy): publish to GHCR after green CI and trigger Dokploy by webhook
| |/
| *   314b648 Merge pull request #31 from PrintJero/018-pwa-installable
| |\
| | * b37484a docs(018): close T018-T019, mark the spec Finished
| | * 695d587 test(018): core screens at iPhone 13 and Pixel 7 sizes (US3)
| | * 74b6674 test(018): offline fallback, network-first freshness, no PII in offline page (US2)
| | * def9b89 feat(018): installable PWA — manifest, iOS metadata, privacy-bounded service worker (US1)
| | * bd53e17 feat(018): icons, offline page, and ship public/ in the image (T001-T004)
| | * e875782 docs(018): apply /speckit-analyze remediation to tasks
| | * cc1076b docs(018): generate tasks (19 tasks, tests first)
| | * 58b288e docs(018): plan, research, data model, contracts and quickstart
| | * ee4f22b docs(018): clarify that installation uses the browser's native UI only
| | * e43ea06 feat(018): specify the installable PWA
| * e564dc7 Merge pull request #30 from PrintJero/docs/backlog
| * 3e8702e Merge pull request #29 from PrintJero/test/011-verification
| * ffca6c7 Merge pull request #28 from PrintJero/fix/deps
| * 02efbd9 Merge pull request #27 from PrintJero/fix/docker-entrypoint-crlf
| * d8f59ce Merge pull request #26 from PrintJero/chore/gitflow-ci
| * 82977e7 Merge pull request #25 from PrintJero/fix/quality-gates
|/
* f912aef Merge pull request #24 from PrintJero/feature/docker
```

---

## 7. Release

- **Tag:** `v1.0.0` (anotado: "CMarket v1.0.0") sobre `5b651cb`.
- **GitHub Release:** <https://github.com/PrintJero/CMarket-speckit/releases/tag/v1.0.0>, con las notas de `CHANGELOG.md`.
- **Constitución:** **4.1.1**. Bump PATCH: la referencia "spec 001" se corrigió a `specs/004-invitations-membership`.
- **Spec Kit:** las casillas de `specs/*/tasks.md` de las specs 002 a 018 están todas en `[x]`.
- **Imágenes publicadas** por el workflow Deploy tras el CI en verde:
  - `ghcr.io/printjero/cmarket-speckit:main`, `:latest`, `:main-tools` y `:sha-<short>` por commit;
  - `:develop` y `:develop-tools`.

  El paquete es público.

### Hotfix v1.0.1 (27/11/2026)

Después del primer despliegue, los correos de verificación fallaban. La causa fue `EMAIL_WEBHOOK_TOKEN` pegado con el prefijo `RESEND_API_KEY=` y comillas (Jero lo corrigió en Dokploy). El hotfix (`hotfix/email-error-detail` → `main`, [PR #38](https://github.com/PrintJero/CMarket-speckit/pull/38)) evita que ese tipo de fallo vuelva a ser opaco:

| Archivo                                                          | Error                                                                   | Causa raíz                                                                 | Solución                                                                                                         | Commit    |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------- |
| `src/lib/email/sendEmail.ts`                                     | El error de envío decía solo "status 401"                               | El transporte descartaba el cuerpo de la respuesta del proveedor           | `EmailDeliveryError` con status y cuerpo (truncado a 300 caracteres, token redactado) y fallos de red reportados | `d790be4` |
| `accountService.ts`, rutas `sign-up` y `resend-verification`, UI | 500 sin capturar y "Something went wrong."                              | La excepción de envío escapaba de la ruta                                  | Resultado `email_delivery_failed`, 503 con un mensaje claro y reintentable, y los botones siguen habilitados     | `343f234` |
| `verificationService.ts`                                         | **Al sexto intento fallido, el registro respondía 202 sin enviar nada** | Los tokens de envíos fallidos contaban para el límite de 5 cada 15 minutos | El token no entregado se descarta; el reintento siempre envía                                                    | `343f234` |

- **Pruebas:** 10 tests nuevos escritos primero (rojo), 5 unitarios y 5 de contrato, más 1 e2e de UI.
  - Unit/contract: **392/392**.
  - E2E: **124/124 en 3 corridas seguidas**.
- **Nota de diseño (spec 002, non-enumeration):** solo mientras el envío está caído, un correo ya verificado recibe 202 donde uno nuevo o sin verificar recibe 503. Quedó documentado en el CHANGELOG y en el PR para que Jero decida si prefiere mantener el 202 también en ese caso.
- **Tag** `v1.0.1` sobre `63cb92e`, [GitHub Release](https://github.com/PrintJero/CMarket-speckit/releases/tag/v1.0.1), back-merge a `develop` ([PR #39](https://github.com/PrintJero/CMarket-speckit/pull/39)).

---

## 8. Producción

**Setup real** (lo configuró Jero en Dokploy; detalle en el README, "Production deployment (Dokploy)"):

| Concepto            | Valor                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| URL                 | <https://cmarket-cmarketspeckit-pakwhf-3d0eae-18-159-111-110.sslip.io> (HTTPS con Let's Encrypt)                                                                                                                                                                                                                                                                                                                                        |
| Aplicación          | Dokploy, proyecto `CMarket` / `production`, servicio `Cmarket-SpecKit`: tipo Application, Provider Docker, imagen `ghcr.io/printjero/cmarket-speckit:main`, Autodeploy encendido (lo requiere el webhook; sin build por git)                                                                                                                                                                                                            |
| Base de datos       | Servicio aparte `cmarket-speckit-db` (`postgres:16-alpine`), solo en la red interna; nueva y exclusiva de esta app                                                                                                                                                                                                                                                                                                                      |
| Pipeline            | Solo `main` despliega: secret `DOKPLOY_WEBHOOK_URL` y variable `APP_URL` en el Environment `production`; `develop` no despliega (un solo servidor). El servidor nunca construye (3.8 GB de RAM)                                                                                                                                                                                                                                         |
| Fecha del deploy    | **v1.0.0:** 27/11/2026, hecho por Jero directamente en Dokploy con `:main` (`sha-5b651cb`). **v1.0.1:** 27/11/2026, a partir de las 11:46 UTC, por el pipeline completo: merge a `main` → CI verde → Deploy (run 45993628675) → Dokploy notificado (HTTP 200) → `/api/health` 200. Además se verificó que producción sirve esa build: el `BUILD_ID` `o7u3FaYkafIaApK_h9p3K` de la imagen `sha-63cb92e` aparece en el HTML de producción |
| Incidente de correo | Los correos de verificación fallaban: `EMAIL_WEBHOOK_TOKEN` se pegó como `RESEND_API_KEY="…"` (con prefijo y comillas, copiado de Bella). Jero lo corrigió. El hotfix v1.0.1 hace que este tipo de error sea diagnosticable                                                                                                                                                                                                             |
| Tareas programadas  | Configuración exacta documentada en el README ("Scheduled jobs"): cleanup cada 15 minutos en `Cmarket-SpecKit` y archivado diario en `cmarket-tools`. **Pendiente de crearlas en Dokploy**                                                                                                                                                                                                                                              |
| Backups             | **Pendientes:** requieren un destino S3 (ver BACKLOG)                                                                                                                                                                                                                                                                                                                                                                                   |

**Smoke test (sección 8.6), 14 puntos.** La parte automatizada se ejecutó con `npm run test:smoke` contra producción el 27/11/2026: a las 11:27 UTC sobre v1.0.0 y a las 11:56 UTC sobre v1.0.1. **9/9 en verde las dos veces.**

| #   | Punto                                                          | Resultado                                                                                                         |
| --- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | `GET /api/health` → 200                                        | ✅ Automatizado (11:27 UTC) y verificado por Jero                                                                 |
| 2   | Home y login sin errores de consola                            | ✅ Automatizado: `/`, `/sign-in` y `/sign-up` sin errores                                                         |
| 3   | Registro, correo real, verificación e inicio de sesión         | ✅ Verificado por Jero (Resend), tras corregir el token                                                           |
| 4   | Inicio de sesión con Google                                    | ✅ Verificado por Jero. OAuth en modo **Prueba** (solo usuarios de prueba; ver BACKLOG)                           |
| 5   | Invitación, aceptación y feed                                  | ⏳ Pendiente: requiere el bootstrap (comunidad piloto)                                                            |
| 6   | Listing con foto en Cloudinary                                 | ⏳ Pendiente: requiere el bootstrap                                                                               |
| 7   | Foto sin cookie → 401                                          | ✅ Automatizado, y verificado por Jero                                                                            |
| 8   | Mensaje recibido por la otra cuenta                            | ⏳ Pendiente: requiere el bootstrap                                                                               |
| 9   | Propuesta aceptada en ambos historiales, sin datos de contacto | ⏳ Pendiente: requiere el bootstrap                                                                               |
| 10  | Otra comunidad no ve el listing ni la imagen                   | ⏳ Pendiente: requiere dos comunidades                                                                            |
| 11  | PWA: manifest, worker e instalación                            | ✅ Instalabilidad automatizada (motor de Chrome: 0 errores) y verificada por Jero. ⏳ Instalación en iOS (manual) |
| 12  | Cleanup con token → 200; sin token → 401                       | ✅ Sin token → 401 (automatizado). ⏳ Con token: se verifica al crear el schedule                                 |
| 13  | Logs sin errores ni secretos                                   | ⏳ Pendiente de revisar en Dokploy                                                                                |
| 14  | Switches de prueba apagados                                    | ✅ Automatizado: `/operator`, `/api/operator/create-community` y `/api/test/last-email` → 404                     |

---

## 9. Backlog y riesgos conocidos

Detalle completo en [`specs/BACKLOG.md`](../specs/BACKLOG.md):

- **Fuera de v1.0.0:**
  - pago dentro de la app (Principio IV-b), con sus requisitos constitucionales documentados;
  - códigos de acceso (prohibido crear la spec hasta que una comunidad real lo requiera);
  - notificaciones push (limitación de iOS).
- **`npm audit`:** quedan 0 críticas y 4 altas, todas en el toolchain de Prisma. Solo se corrigen con Prisma 7 (versión mayor).
- **Riesgos menores:**
  - el mock de Google OAuth compartido entre archivos de prueba;
  - acciones duplicadas en la pestaña Lifecycle de una comunidad suspendida (cosmético);
  - **revisar `accounts.displayName` en cualquier base que haya aceptado registros con Google antes de v1.0.0** (bug corregido en #25).
- **6 advertencias de lint** (`no-location-assign-relative-destination`, nuevas con `eslint-config-next` 16.4.6). Son navegaciones completas **intencionales** tras cambios de sesión: inicio y cierre de sesión, cambio de comunidad y cambio de contraseña MASTER. Un `router.push` dejaría en pantalla datos de la sesión anterior. No se silenciaron, porque está prohibido.

---

## 10. Decisiones tomadas por Claude Code y por qué

1. **Orden de los PRs de la Fase 1:** `fix/quality-gates` se mergeó antes que `chore/gitflow-ci`, porque el CI no podía salir verde con los errores existentes. Todas las correcciones fueron en un solo PR, también para que el CI saliera verde.
2. **E2E contra la build de producción** en lugar de `next dev`: era la causa raíz de la intermitencia, la suite pasó a ser 4 veces más rápida y prueba lo que se despliega.
3. **Pruebas de MASTER actualizadas, no la UI:** el rediseño `62f184b` es intencional. La spec 009 exige comportamientos, no textos.
4. **Prettier excluye `specs/`, `.specify/` y `.claude/`** (prosa de Spec Kit). Se agregó `.gitattributes` con LF.
5. **`allowScripts` en `package.json`:** npm 11 (Node 24) bloquea los scripts de instalación de Prisma, esbuild y otros si no se aprueban.
6. **Se eliminó `@auth/prisma-adapter`** en lugar de subirlo: no se usaba.
7. **Spec 018:**

- instalación solo con la UI nativa del navegador;
- íconos generados con el Chromium de Playwright, para no agregar dependencias;
- instalabilidad verificada con CDP `Page.getInstallabilityErrors`, porque Lighthouse ya no tiene categoría PWA;
- service workers bloqueados por defecto en la suite (hallazgo U1 de `/speckit-analyze`).

8. **Deploy por imagen** (GHCR + webhook) en lugar de construir en el servidor, según la política de secretos de Jero y porque el servidor (3.8 GB de RAM) no puede compilar Next.js. Se agregó una imagen `-tools`, porque la imagen standalone no puede ejecutar `bootstrap-master`, `create-community` ni el archivado diario de la spec 009.
9. **El schedule de cleanup corre dentro de `Cmarket-SpecKit` con el `fetch` de Node** (las imágenes no traen `curl`), usando el `CLEANUP_TOKEN` que el contenedor ya tiene. Así el token no se copia en la configuración de Dokploy.
10. **Documentación técnica en inglés** (README, CHANGELOG, BACKLOG), por consistencia con el repositorio. Este reporte va en español.

---

## 11. Pendientes que requieren a Jero

_Actualizado el 27/11/2026, después del despliegue._ Ya resuelto por Jero: acceso a Dokploy, HTTPS, variables de entorno, la base nueva, y `DOKPLOY_WEBHOOK_URL` y `APP_URL` en `production`. Queda:

1. **Bootstrap** en Dokploy: el servicio `cmarket-tools`, el primer MASTER y la comunidad piloto con su cuenta ya verificada (pasos exactos en el README, "Bootstrap").
2. **Crear los dos schedules** en Dokploy (configuración exacta en el README, "Scheduled jobs").
3. **Backups automáticos y una restauración probada** antes de onboardear la primera comunidad real. Requieren un destino S3 (BACKLOG).
4. Completar a mano los puntos 5, 6, 8, 9, 10, 11 (iOS) y 13 del smoke test.
5. **Publicar la app de Google OAuth** cuando haya dominio propio y una página `/privacy` (BACKLOG).
