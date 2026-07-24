# Research: Platform Administration

No `NEEDS CLARIFICATION` markers remain in the Technical Context — the stack is fixed by the constitution (Next.js/Prisma/PostgreSQL/Docker/Dokploy) and spec.md's own Clarifications session already resolved every product-level ambiguity. What follows are the architectural decisions needed to turn spec.md's 78 functional requirements into a concrete design, each chosen against the existing 002–008 codebase conventions rather than inventing new ones.

**Constitutional grounding**: this feature is planned against **Constitution v4.1.0**, which adds Principle IX ("Platform Administration Authority", NON-NEGOTIABLE) specifically to authorize the MASTER identity, the managed-account-provisioning exception to Principle I, MASTER's role as Principle III's documented escalation path, the bounded Principle VI exception, the last-MASTER guard, and the administrative audit log — including its rejected-attempt requirement (research.md #6 below). Several decisions below that would otherwise read as this feature's own ad hoc choice are, as of v4.1.0, direct constitutional requirements; each is annotated where that applies.

## 1. MASTER identity/session model: fully separate from Account/Session

**Decision**: Two new Prisma models, `MasterIdentity` and `MasterSession`, with their own session cookie (`cmarket_master_session`) and their own `getCurrentMaster()` helper (mirrors `getCurrentAccount()`). No shared table with `Account`/`Session`.

**Rationale**: Constitution v4.1.0 Principle IX requires MASTER identities to be "entirely separate from ordinary Account identities and from community Membership," never interchangeable with a marketplace session (spec.md FR-001/FR-004/FR-005 state the same requirement at the feature level). A shared table with a `type` discriminator would require every existing `getValidSession()`/`getCurrentAccount()` call site (002–008) to add a type check to avoid accidentally treating a MASTER session as an Account session — a correctness landmine. Two physically separate tables make "a MASTER session token can never authenticate as an Account, and vice versa" true by construction, not by a discipline everyone must remember (Story 1, Scenario 3/4).

**Alternatives considered**: A `role`/`type` column on the existing `Account`/`Session` tables — rejected, since it reintroduces exactly the "promoted account" shape both FR-009 and Principle IX explicitly forbid, and would make every existing marketplace query one missed `WHERE` clause away from leaking MASTER rows into member-facing lists.

## 2. Password hashing and session-token hashing: reuse existing primitives

**Decision**: `MasterIdentity.passwordHash` uses the existing `hashPassword`/`verifyPassword` (Argon2id, `src/lib/auth/passwordHash.ts`) unchanged. `MasterSession.sessionTokenHash` uses the existing SHA-256 `hashToken()` pattern from `sessionService.ts` (a new, parallel `masterSessionService.ts`, not a modification of the existing file).

**Rationale**: Principle VII — no new hashing dependency for a credential that has the exact same "high-entropy random session token, low-entropy human password" shape sessions/accounts already solve correctly.

**Alternatives considered**: A separate hashing library "because it's more sensitive" — rejected; Argon2id is already the right primitive and duplicating it with different parameters adds risk without benefit.

## 3. Master ID normalization

**Decision**: A new `src/lib/validation/masterId.ts`, mirroring `email.ts`: `normalizeMasterId()` (trim + lowercase) and `isValidMasterId()` (non-blank after trim, ≤50 chars, restricted to `[a-z0-9._-]` after normalization). Stored pre-normalized in `MasterIdentity.masterId` (unique) — there is no display-cased original to preserve, since spec.md's Edge Cases say a Master ID "cannot be changed," so normalize-on-write is safe and permanent.

**Rationale**: Identical shape to the existing case-insensitive-email pattern (FR: "case-insensitive for uniqueness and sign-in, is trimmed") — reusing the pattern instead of inventing a citext/collation-based alternative keeps this feature consistent with 002's already-reviewed approach.

## 4. Cross-store email uniqueness (FR-015)

**Decision**: Enforce the constitution-preferred option explicitly named in FR-015 and now mandated by Constitution v4.1.0 Principle IX — a MASTER email MUST NOT match any existing `Account.email` (and vice versa going forward), checked with a plain cross-table lookup (`prisma.account.findUnique` / `prisma.masterIdentity.findUnique` by normalized email) inside `createMaster()`, before insert.

**Rationale**: Postgres cannot express a single `UNIQUE` constraint across two separate tables without a shared registry table or a trigger — both of which are more machinery than this rare, MASTER-driven, low-concurrency operation justifies (Principle VII). The existing codebase already accepts an equivalent narrow TOCTOU window elsewhere (`signUp()`'s own findUnique-then-create is only truly guaranteed unique by `Account.email`'s DB-level `@unique`), so this feature accepts the same class of race for the same reason, documented rather than silently assumed.

**Alternatives considered**: A shared `email_registry` table with one DB-level unique constraint referenced by both `Account` and `MasterIdentity` — rejected as a cross-cutting change to the existing, already-shipped `Account` model for a benefit (closing a race in an admin-only, human-paced flow) that doesn't justify touching 002's schema.

## 5. Bootstrap mechanism for the first MASTER (FR-007, FR-008)

**Decision**: A new `scripts/bootstrap-master.ts`, run via `tsx` exactly like the existing `scripts/create-community.ts`, guarded by `prisma.masterIdentity.count() === 0` (refuses otherwise). Never reachable from any `app/` route — enforced by a new architectural test, `tests/unit/test_master_bootstrap_not_networked.ts`, mirroring the existing `test_community_creation_not_networked.ts`. This is now a direct requirement of Constitution v4.1.0 Principle IX ("created through a documented deployment/bootstrap process outside user-facing application routes"), not only this feature's own FR-007.

**Rationale**: Directly mirrors an already-reviewed, already-shipped pattern in this exact codebase for the exact same shape of problem ("the one action that must happen before any authenticated actor can perform the next one").

**Alternatives considered**: A one-time-use setup wizard page gated by an environment flag (like `app/operator`) — rejected; spec.md's own Assumptions call the bootstrap "operational tooling, not a public route," so even a flag-gated page is more surface area than a CLI script needs.

## 6. Administrative audit log: storage shape and transaction discipline

**Decision (shape)**: One new model, `AdministrativeAuditEntry`: `actorType` (`MASTER` | `SYSTEM` enum), `actorMasterId` (nullable FK, null when `actorType = SYSTEM`), `action` (plain `String`, not a Prisma enum — see rationale), `targetType` (`String`), `targetId` (`String?`, nullable for actions with no single target, e.g. a rejected bootstrap retry), `outcome` (`SUCCESS` | `FAILURE` enum), `detail` (`Json?`, sanitized before/after context), `createdAt`.

**Rationale (shape)**: `action` and `targetType` stay plain strings because this feature alone names 20+ distinct action shapes (create-master, disable-master, suspend-community, restore-community, delete-account, …) and more will be added by future specs (FR-069's list is explicitly not closed) — a Prisma enum would need a migration for every future addition, which `ListingStatus`/`MembershipRole` (small, genuinely closed sets) don't face. `outcome` stays an enum because it is genuinely closed and every consumer (filtering, rendering) benefits from the exhaustiveness check. Immutability (FR-071) is enforced the same way `Message`'s "no edit/delete" is enforced in 008 — by never exposing an update/delete path through any service or route, not by a DB trigger (Principle VII).

**Decision (transaction discipline — corrected)**: `writeAuditEntry()` always takes an explicit Prisma client argument, and is called with one of two disciplines depending on outcome:

1. **SUCCESS entries** are written with the *same* transaction client (`tx`) as the mutation they describe, as the last statement before that `$transaction` resolves. The mutation and its audit record commit together or neither commits — there is no code path where a mutation succeeds but goes unaudited.
2. **FAILURE entries**, for an *expected* rejection (a business-rule guard intentionally refusing an action — last-MASTER, last-administrator/orphan guard, self-disable, invalid input, a conflicting state, "not eligible," etc.), are written with the plain top-level `prisma` client, as an independent statement executed **after** the guarded attempt's own transaction has already rolled back or returned. A FAILURE entry is never nested inside the transaction whose rollback it is recording — if it were, the audit write would be rolled back along with the rejected mutation, and the rejected attempt would leave no trace at all.

Concretely, a guarded mutation follows this shape:

```ts
async function disableMaster(callerMasterId: string, targetMasterId: string) {
  if (targetMasterId === callerMasterId) {
    await writeAuditEntry(prisma, { outcome: "FAILURE", action: "master.disable", ... }); // independent write
    return { ok: false, reason: "cannot_disable_self" };
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const activeCount = await tx.masterIdentity.count({ where: { status: "ACTIVE" } });
      if (activeCount <= 1) throw new LastMasterGuardError();
      await tx.masterIdentity.update({ where: { id: targetMasterId }, data: { status: "DISABLED" } });
      await tx.masterSession.deleteMany({ where: { masterId: targetMasterId } });
      await writeAuditEntry(tx, { outcome: "SUCCESS", action: "master.disable", ... }); // atomic with mutation
      return { ok: true };
    });
  } catch (err) {
    if (err instanceof LastMasterGuardError) {
      await writeAuditEntry(prisma, { outcome: "FAILURE", action: "master.disable", ... }); // independent write,
      return { ok: false, reason: "last_active_master" };                                   // tx already rolled back
    }
    throw err;
  }
}
```

**Rationale (transaction discipline)**: Constitution v4.1.0 Principle IX is explicit: "A rejected or failed state-changing attempt MUST still produce its own audit entry — its failure to persist the attempted change MUST NOT also prevent the record of that attempt from persisting" (mirrored by spec.md FR-068/FR-072 Scenario 2). Nesting the FAILURE write inside the same transaction the guard just aborted would silently violate this the moment Postgres rolls the transaction back — the audit *record itself* is data the rejected mutation's rollback must not be allowed to erase. Writing FAILURE entries independently, after the fact, is the only way to guarantee they survive exactly the rollback they describe. This applies only to *expected* rejections evaluated by the service itself (a guard returning a known `reason`) — a genuinely unexpected error (e.g., a database connectivity fault) is an infrastructure fault, not an "attempted action" FR-068 asks to be recorded, and is not required to produce a FAILURE entry.

**Alternatives considered**: Writing every audit entry (success or failure) via the plain `prisma` client, never `tx` — rejected, because it would then be possible for a mutation to commit (via `tx`) while its SUCCESS audit write (a separate, later statement) fails independently, leaving a real state change with no audit trail — exactly the "silently unaudited successful mutation" the atomic SUCCESS path exists to prevent. Reusing/extending the future marketplace Transaction Log for this — explicitly rejected by FR-074 and the spec's own framing; these are different domains (platform governance vs. marketplace money movement) that happen to share "immutable log" as a shape.

## 7. Community lifecycle background transition (FR-057)

**Decision**: A new `scripts/archive-suspended-communities.ts` (same `tsx` CLI shape as #5), calling a new `archiveDueSuspendedCommunities()` in `communityLifecycleService.ts`. Intended to run on a schedule via Dokploy's own cron capability — no new in-process scheduler dependency (`node-cron`, `setInterval`, a queue) is added to `package.json`.

**Rationale**: Principle VII — this repo has zero existing job-scheduling infrastructure; introducing one for a single once-a-day transition is disproportionate. Dokploy is already the deployment platform the constitution commits to, and scheduled jobs are exactly the kind of "deployment pipeline" concern the constitution already treats as configuration rather than application code (see "Migrations & backups").

**Alternatives considered**: Lazy transition-on-read (check `archiveScheduledAt` the moment any code touches the community) — rejected: it would silently vary a community's observable state depending on who happens to look at it first, and several FRs (SC-007, "every continuously suspended community transitions... on or after its deadline") read most naturally as an actual state change that has happened, not a computed view.

## 8. Restoration continuity: a community operational epoch (FR-064, FR-077)

**Decision**: `Community` gains an integer `operationalEpoch` column, starting at `1`. Every `Listing`, `MessageThread`, `Invitation`, and `Membership` row is stamped, at creation, with the `operationalEpoch` its community held *at that moment*. `operationalEpoch` is otherwise immutable on all four of those models — it is never updated after creation, **except** for exactly one `Membership` row at the moment of restoration (below). Restoring an archived community increments `Community.operationalEpoch` by 1 (opening a new epoch) and updates *only* the selected administrator's `Membership.operationalEpoch` to that new value — every other pre-restoration `Listing`/`MessageThread`/`Invitation`/`Membership` row keeps its old epoch number, permanently. Every operational read path for these four entities (discovery feed, thread inbox, invitation-acceptance lookup, current-membership check) filters by `operationalEpoch: community.operationalEpoch` (the community's *current* value) in addition to whatever filter it already applies.

This single mechanism replaces the separate `Membership.status` (`ACTIVE`/`ARCHIVED`) enum an earlier draft of this plan proposed — see Alternatives considered.

**Rationale**: This is the load-bearing design decision of the whole feature. `Community.status` alone (`ACTIVE`/`SUSPENDED`/`ARCHIVED`) cannot express FR-064/FR-077 once a community is restored: the moment `status` flips back to `ACTIVE`, a status-only design has no remaining signal to distinguish "this listing/thread/invitation/membership predates the archival" from "this one was created after restoration" — every pre-archive row would silently reappear in every operational query the instant the community-level gate reopens. An explicit epoch number, stamped once at creation and compared against the community's *current* epoch on every operational read, makes that distinction a plain equality check rather than something inferred from timestamps (which would need a second column — `archivedAt`/`restoredAt` — compared with `<`/`>=` at every call site, more error-prone than one `===`). It also directly explains why *this one row* (the restored administrator's own membership) is the sole exception: restoration is defined as "move exactly one row into the new epoch," not "recompute status for everyone."

A useful consequence: **archival itself now touches zero `Listing`/`MessageThread`/`Invitation`/`Membership` rows.** An earlier draft of this plan bulk-updated every membership to an `ARCHIVED` status at archival time; the epoch design makes that unnecessary — while a community is `ARCHIVED`, `Community.status !== "ACTIVE"` already blocks every ordinary marketplace path outright (FR-059), so nothing about the child rows needs to change until (and unless) the community is later restored and the epoch comparison starts doing its job. This is strictly simpler than the status-column design it replaces: one column, stamped once at creation, touched again only by the one restoration action that needs it — no bulk update, no second enum.

**Consequence — existing call sites must be updated**: every current-membership/listing/thread/invitation check written for 002–008 that establishes "this row is currently operational" must add `operationalEpoch: <community's current epoch>` to its query (`requireCommunityMembership()`, `requireCommunityAdministrator()`, `getCurrentAccount()`'s membership listing, `listMyThreads()`/`listMyListings()`'s community-id resolution, the listing-discovery feed, invitation-acceptance lookup). This is a required, cross-cutting update, not a violation of anything — flagged explicitly in plan.md's Project Structure and Complexity Tracking so it isn't missed. External behavior for every pre-009 scenario is unchanged: every row created before this feature ships is stamped with epoch `1`, and every community starts at epoch `1`, so `operationalEpoch: community.operationalEpoch` is true for every one of them until the first restoration a community ever undergoes — which is a state that, by definition, did not exist before this feature.

**Alternatives considered**:

- *A `Membership.status` (`ACTIVE`/`ARCHIVED`) enum, with bulk-archival-time updates* (this plan's original draft) — rejected on reflection: it only solved the problem for `Membership`, leaving `Listing`/`MessageThread`/`Invitation` needing some *other* mechanism to satisfy the same FR-064/FR-077 requirement for them (a listing or an invitation has no "role" to distinguish it the way a restored administrator's membership does). The epoch mechanism handles all four entities with one column and one comparison, and — as noted above — turns out to need *less* write-time work overall (no bulk update at archival), which is what "prefer an operational epoch unless a simpler design fully satisfies FR-064 and FR-077" comes down to in practice: the status-enum alternative wasn't actually simpler once every affected entity is accounted for, it was simpler only for the one entity it was designed around.
- *Comparing `createdAt` against a stored `archivedAt`/`restoredAt` timestamp at every read site* — rejected: it requires two columns and a `<`/`>=` comparison repeated at every call site instead of one column and an `===`, does not obviously generalize to a *second* archive/restore cycle on the same community (an epoch counter does, by simply incrementing again), and cannot express "this one specific membership is the exception" without also storing something per-row anyway — at which point it has reinvented the epoch column under a different name.

## 9. Account status for suspend/reactivate and permanent deletion

**Decision**: `Account` gains `status` (`ACTIVE` | `SUSPENDED` enum, default `ACTIVE`) and `deletedAt` (`DateTime?`). Suspension sets `status = SUSPENDED` and deletes all `Session` rows (mirrors #11 below for MASTER). Sign-in (`signInWithPassword`) and session validation (`getValidSession`) both add a `status === "ACTIVE" && deletedAt === null` check. Permanent deletion (FR-034) is a **soft** delete: `deletedAt` is set, `email` is overwritten with a non-reusable synthetic value (e.g. `deleted-{accountId}@deleted.invalid`) freeing the original address for future reuse (Edge Cases), `passwordHash` is cleared, and every `AuthIdentity`/`Session`/`VerificationToken` row is deleted (credentials, not historical business records). The `Account` row itself is never deleted, so every existing FK (`Listing.ownerId`, `Message.senderId`, `Membership.accountId`, audit-entry references) remains valid — exactly the "non-reassignable internal actor reference" FR-034 requires.

**Rationale**: The same insight as #8 applied to accounts: "the row must never disappear (for FK/history integrity), but its operational capability must be revocable." Overwriting `email`+clearing credentials is sufficient to make the account permanently unable to authenticate or be found by its old address, without the cascading-delete blast radius (`onDelete: Cascade` on `Listing`, `Membership`, `Message.sender`) that physically deleting the row would trigger — which FR-034 explicitly forbids ("retaining... historical attribution").

**Alternatives considered**: Physically deleting the `Account` row and reassigning its historical records to a shared "deleted user" placeholder account — rejected; spec.md explicitly says records must carry "a non-reassignable internal actor reference," i.e. still point at *that* account, not a shared stand-in.

## 10. MASTER-provisioned ordinary accounts carry no pending credential state (FR-025)

**Decision**: When a MASTER (or MASTER-driven community creation) provisions a new `Account`, it is created with `emailVerifiedAt` set immediately (verified=true) and `passwordHash` set directly from the generated temporary password's hash — no `VerificationToken` row is ever created for this path. This is the concrete implementation of Constitution v4.1.0 Principle IX's "managed account provisioning" exception to Principle I.

**Rationale**: FR-025 forbids leaving "any untrusted pending password credential or verification token capable of taking control after provisioning." The simplest way to guarantee nothing is left to hijack is to never create it in the first place, rather than creating and then having to remember to invalidate a token (Principle VII).

## 11. MASTER self-management guards (last-MASTER, self-disable)

**Decision**: `disableMaster()` checks, inside the same transaction: (a) target is not the caller (`self-disable` rejection, FR-014), (b) `prisma.masterIdentity.count({ where: { status: "ACTIVE" } })` is `> 1` before allowing the target to become the count-reducing disable (last-MASTER guard, FR-013 — now also a direct requirement of Constitution v4.1.0 Principle IX). Disabling/resetting a MASTER deletes all of its `MasterSession` rows (FR-012). Both guard rejections are expected-failure paths and follow research.md #6's independent-FAILURE-audit-write discipline exactly (see #6's worked example, which is this very function).

**Rationale**: Directly mirrors the existing last-administrator guard shape already implemented for communities in `invitationService.ts` (`administratorCount` check inside the same `$transaction` as the delete) — same pattern, new table.

## 12. Community creation by MASTER: one atomic operation covering both founder paths

**Decision**: A new `createCommunityAsMaster()` in `communityLifecycleService.ts` (not a reuse of the existing operator-only `createCommunity()`, which requires a *pre-existing* verified account and has no "provision a new one" branch). Inside one `prisma.$transaction`: resolve or create the founding `Account` (per #10, if provisioning), create the `Community` (`status: ACTIVE`, `operationalEpoch: 1`), create its `ADMINISTRATOR` `Membership` (stamped with `operationalEpoch: 1`, per #8), and write the SUCCESS `AdministrativeAuditEntry` — all four writes or none (FR-026).

**Rationale**: FR-024's "provision a new account" branch has no equivalent in the existing `createCommunity()`, and bolting it on would blur that function's already-narrow, already-tested contract ("only ever an existing verified account," enforced by `tests/unit/test_community_creation_not_networked.ts`'s allow-list). A new function keeps both call paths honest about what they each guarantee. The existing `app/operator` dev-only panel and `scripts/create-community.ts` are **not removed or modified** — spec.md's own "Constitution and Existing-Spec Impact" section, and now Constitution v4.1.0 Principle IX directly, supersede spec 003's restriction only for the new MASTER flow, leaving the pre-existing dev/local-bootstrap path exactly as it was.

## 13. Route and page namespace

**Decision**: `app/master/` for pages (sign-in, dashboard, communities, community detail, accounts, masters, audit-log) and `app/api/master/` for routes — mirrors the existing single-word `app/operator/` naming precedent already in this codebase for an analogous "separate administrative area" concept. A `requireMaster()` helper (mirrors `getCurrentAccount()`) gates every page and route in this namespace.

**Rationale**: Consistency with an already-reviewed naming convention in the same codebase, and a single, obvious place to point every "MASTER-only" authorization check.

## 14. Invitation behavior on ordinary-account email change (FR-045) — resolved, not deferred

**Decision**: Changing an `Account`'s email does **not** transfer, rewrite, or otherwise retarget any existing `Invitation` row. A pending invitation remains permanently bound to the email address it was issued to. If that invitation should reach the account's new email, an administrator must explicitly revoke it and issue a new one to the new address, using the existing invitation capability (spec 004) unchanged — this feature adds no new capability for that case. This is now stated directly in spec.md's FR-045 (no longer deferred to "before implementation").

**Rationale**: `Invitation` is already, by design, "a single-use credential binding one email address to one Community" (data-model.md, 004) — email-binding is its entire security property (Principle I: "a credential MUST only be redeemable by an account with a verified email matching the recipient"). Silently re-binding it to a changed email would weaken that property for a case spec.md doesn't ask to solve; revoke-and-reissue is the existing, already-safe mechanism, and requires no new code path.

## 15. Suspended/archived-community read-path gating reuses existing gate functions

**Decision**: `requireCommunityMembership()` and every listing/message read-or-write path additionally check `Community.status`. Specifically: viewing existing listings and sending/receiving in existing threads check `status IN (ACTIVE, SUSPENDED)`; every growth/creation action (new listing, new thread, invitation issue/accept, membership admission, promotion/demotion, pausing→reactivating a listing) checks `status === ACTIVE` only; archived communities check `status === ACTIVE` for every ordinary-marketplace path (i.e., are excluded identically to a plain "not found"). This check is independent of, and in addition to, the `operationalEpoch` check from #8 — `status` answers "is this community open for business at all right now," `operationalEpoch` answers "does this specific row belong to the community's current operational generation." Both must hold for an ordinary read/write to succeed.

**Rationale**: Keeps the existing gate-function shape (`{ ok, reason }`) as the single enforcement point, exactly as 005–008 already centralize community-membership checks — this feature only widens what each gate checks, it doesn't invent a parallel authorization mechanism.
