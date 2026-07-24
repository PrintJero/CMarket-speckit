import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createMaster,
  signInAsMaster,
  changeMasterPassword,
  disableMaster,
  reactivateMaster,
  resetMasterPassword,
} from "@/server/services/masterAuthService";
import { getValidMasterSession } from "@/server/services/masterSessionService";

async function resetMasterState() {
  await prisma.administrativeAuditEntry.deleteMany({});
  await prisma.masterSession.deleteMany({});
  await prisma.masterIdentity.deleteMany({});
  await prisma.account.deleteMany({ where: { email: { contains: "master-auth-test" } } });
}

describe("masterAuthService (contract)", () => {
  beforeEach(resetMasterState);
  afterAll(async () => {
    await resetMasterState();
    await prisma.$disconnect();
  });

  describe("createMaster — bootstrap path (User Story 2, FR-007, FR-008)", () => {
    it("creates exactly one ACTIVE, mustChangePassword MasterIdentity against an empty table, with a SUCCESS audit entry", async () => {
      const result = await createMaster({ masterId: "root", email: "root@example.com", createdByMasterId: null });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected success");
      expect(result.temporaryPassword.length).toBeGreaterThan(0);

      const master = await prisma.masterIdentity.findUnique({ where: { id: result.master.id } });
      expect(master?.status).toBe("ACTIVE");
      expect(master?.mustChangePassword).toBe(true);
      expect(master?.createdByMasterId).toBeNull();

      const entries = await prisma.administrativeAuditEntry.findMany({ where: { targetId: result.master.id } });
      expect(entries).toHaveLength(1);
      expect(entries[0].outcome).toBe("SUCCESS");
      expect(entries[0].actorType).toBe("SYSTEM");
    });

    it("refuses a second bootstrap once a MasterIdentity exists, writing an independent FAILURE entry with no new row", async () => {
      await createMaster({ masterId: "root", email: "root@example.com", createdByMasterId: null });

      const second = await createMaster({ masterId: "root2", email: "root2@example.com", createdByMasterId: null });

      expect(second).toEqual({ ok: false, reason: "bootstrap_already_completed" });
      expect(await prisma.masterIdentity.count()).toBe(1);

      const failureEntries = await prisma.administrativeAuditEntry.findMany({
        where: { outcome: "FAILURE", action: "master.create" },
      });
      expect(failureEntries.length).toBeGreaterThanOrEqual(1);
    });

    it("rejects an invalid masterId or email, and an email already used by an Account (research.md #4)", async () => {
      expect(await createMaster({ masterId: "  ", email: "a@example.com", createdByMasterId: null })).toEqual({
        ok: false,
        reason: "invalid_master_id",
      });
      expect(await createMaster({ masterId: "root", email: "not-an-email", createdByMasterId: null })).toEqual({
        ok: false,
        reason: "invalid_email",
      });

      await prisma.account.create({
        data: { email: "master-auth-test-shared@example.com", passwordHash: null, emailVerifiedAt: null },
      });
      expect(
        await createMaster({
          masterId: "root",
          email: "master-auth-test-shared@example.com",
          createdByMasterId: null,
        }),
      ).toEqual({ ok: false, reason: "email_already_in_use" });
    });
  });

  describe("signInAsMaster / changeMasterPassword (User Story 1, FR-003, FR-010, research.md #11)", () => {
    it("signs in with valid credentials, then rejects wrong id, wrong password, and a DISABLED identity identically", async () => {
      const created = await createMaster({ masterId: "alpha", email: "alpha@example.com", createdByMasterId: null });
      if (!created.ok) throw new Error("setup failed");

      const signedIn = await signInAsMaster("alpha", created.temporaryPassword);
      expect(signedIn.ok).toBe(true);
      if (!signedIn.ok) throw new Error("expected success");

      const session = await getValidMasterSession(signedIn.sessionToken);
      expect(session?.masterIdValue).toBe("alpha");
      expect(session?.mustChangePassword).toBe(true);

      expect(await signInAsMaster("nonexistent", created.temporaryPassword)).toEqual({
        ok: false,
        reason: "invalid_credentials",
      });
      expect(await signInAsMaster("alpha", "wrong-password")).toEqual({
        ok: false,
        reason: "invalid_credentials",
      });

      await prisma.masterIdentity.update({ where: { id: created.master.id }, data: { status: "DISABLED" } });
      expect(await signInAsMaster("alpha", created.temporaryPassword)).toEqual({
        ok: false,
        reason: "invalid_credentials",
      });
    });

    it("changeMasterPassword clears mustChangePassword, and rejects a wrong current or weak new password", async () => {
      const created = await createMaster({ masterId: "beta", email: "beta@example.com", createdByMasterId: null });
      if (!created.ok) throw new Error("setup failed");

      expect(
        await changeMasterPassword(created.master.id, "wrong-current", "a-perfectly-fine-new-password-1"),
      ).toEqual({ ok: false, reason: "invalid_current_password" });

      expect(await changeMasterPassword(created.master.id, created.temporaryPassword, "short")).toEqual({
        ok: false,
        reason: "invalid_password",
        passwordReason: "too_short",
      });

      const result = await changeMasterPassword(
        created.master.id,
        created.temporaryPassword,
        "a-perfectly-fine-new-password-1",
      );
      expect(result).toEqual({ ok: true });

      const master = await prisma.masterIdentity.findUnique({ where: { id: created.master.id } });
      expect(master?.mustChangePassword).toBe(false);

      const signedIn = await signInAsMaster("beta", "a-perfectly-fine-new-password-1");
      expect(signedIn.ok).toBe(true);
    });
  });

  describe("MASTER lifecycle management (User Story 3, FR-009, FR-011–FR-014, research.md #6/#11)", () => {
    it("an authenticated MASTER creates another, recording who created it", async () => {
      const a = await createMaster({ masterId: "gamma-a", email: "gamma-a@example.com", createdByMasterId: null });
      if (!a.ok) throw new Error("setup failed");

      const b = await createMaster({ masterId: "gamma-b", email: "gamma-b@example.com", createdByMasterId: a.master.id });
      expect(b.ok).toBe(true);
      if (!b.ok) throw new Error("expected success");

      const masterB = await prisma.masterIdentity.findUnique({ where: { id: b.master.id } });
      expect(masterB?.createdByMasterId).toBe(a.master.id);
    });

    it("disableMaster rejects self-disable, writing an independent FAILURE entry and leaving status unchanged", async () => {
      const a = await createMaster({ masterId: "delta-a", email: "delta-a@example.com", createdByMasterId: null });
      if (!a.ok) throw new Error("setup failed");
      await createMaster({ masterId: "delta-b", email: "delta-b@example.com", createdByMasterId: a.master.id });

      const result = await disableMaster(a.master.id, a.master.id);
      expect(result).toEqual({ ok: false, reason: "cannot_disable_self" });

      const stillActive = await prisma.masterIdentity.findUnique({ where: { id: a.master.id } });
      expect(stillActive?.status).toBe("ACTIVE");

      const failureEntry = await prisma.administrativeAuditEntry.findFirst({
        where: { action: "master.disable", outcome: "FAILURE", targetId: a.master.id },
      });
      expect(failureEntry).not.toBeNull();
    });

    it("disableMaster rejects disabling the last active MASTER, and the guarded mutation genuinely did not commit", async () => {
      const only = await createMaster({ masterId: "epsilon", email: "epsilon@example.com", createdByMasterId: null });
      if (!only.ok) throw new Error("setup failed");

      const result = await disableMaster("some-other-caller-id", only.master.id);
      expect(result).toEqual({ ok: false, reason: "last_active_master" });

      const stillActive = await prisma.masterIdentity.findUnique({ where: { id: only.master.id } });
      expect(stillActive?.status).toBe("ACTIVE");

      const failureEntry = await prisma.administrativeAuditEntry.findFirst({
        where: { action: "master.disable", outcome: "FAILURE", targetId: only.master.id },
      });
      expect(failureEntry).not.toBeNull();
    });

    it("disableMaster succeeds against a non-last, non-self target and revokes its sessions", async () => {
      const a = await createMaster({ masterId: "zeta-a", email: "zeta-a@example.com", createdByMasterId: null });
      if (!a.ok) throw new Error("setup failed");
      const b = await createMaster({ masterId: "zeta-b", email: "zeta-b@example.com", createdByMasterId: a.master.id });
      if (!b.ok) throw new Error("setup failed");

      const signedInB = await signInAsMaster("zeta-b", b.temporaryPassword);
      if (!signedInB.ok) throw new Error("setup failed");

      const result = await disableMaster(a.master.id, b.master.id);
      expect(result).toEqual({ ok: true });

      const masterB = await prisma.masterIdentity.findUnique({ where: { id: b.master.id } });
      expect(masterB?.status).toBe("DISABLED");
      expect(await getValidMasterSession(signedInB.sessionToken)).toBeNull();

      const successEntry = await prisma.administrativeAuditEntry.findFirst({
        where: { action: "master.disable", outcome: "SUCCESS", targetId: b.master.id },
      });
      expect(successEntry).not.toBeNull();
    });

    it("reactivateMaster restores sign-in eligibility", async () => {
      const a = await createMaster({ masterId: "eta-a", email: "eta-a@example.com", createdByMasterId: null });
      if (!a.ok) throw new Error("setup failed");
      const b = await createMaster({ masterId: "eta-b", email: "eta-b@example.com", createdByMasterId: a.master.id });
      if (!b.ok) throw new Error("setup failed");

      await disableMaster(a.master.id, b.master.id);
      expect(await signInAsMaster("eta-b", b.temporaryPassword)).toEqual({ ok: false, reason: "invalid_credentials" });

      await reactivateMaster(a.master.id, b.master.id);
      const signedIn = await signInAsMaster("eta-b", b.temporaryPassword);
      expect(signedIn.ok).toBe(true);
    });

    it("resetMasterPassword issues a new temporary password, revokes sessions, and requires a change on next sign-in", async () => {
      const a = await createMaster({ masterId: "theta-a", email: "theta-a@example.com", createdByMasterId: null });
      if (!a.ok) throw new Error("setup failed");
      const b = await createMaster({ masterId: "theta-b", email: "theta-b@example.com", createdByMasterId: a.master.id });
      if (!b.ok) throw new Error("setup failed");

      await changeMasterPassword(b.master.id, b.temporaryPassword, "an-original-password-1");
      const signedInBefore = await signInAsMaster("theta-b", "an-original-password-1");
      if (!signedInBefore.ok) throw new Error("setup failed");

      const reset = await resetMasterPassword(a.master.id, b.master.id);
      expect(reset.ok).toBe(true);
      if (!reset.ok) throw new Error("expected success");

      expect(await getValidMasterSession(signedInBefore.sessionToken)).toBeNull();
      expect(await signInAsMaster("theta-b", "an-original-password-1")).toEqual({
        ok: false,
        reason: "invalid_credentials",
      });

      const signedInAfter = await signInAsMaster("theta-b", reset.temporaryPassword);
      expect(signedInAfter.ok).toBe(true);
      if (signedInAfter.ok) expect(signedInAfter.mustChangePassword).toBe(true);
    });
  });
});
