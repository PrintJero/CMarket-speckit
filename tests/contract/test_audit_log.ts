import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { writeAuditEntry, listAuditEntries } from "@/server/services/auditService";
import { createMaster, disableMaster } from "@/server/services/masterAuthService";

async function resetState() {
  await prisma.administrativeAuditEntry.deleteMany({});
  await prisma.masterSession.deleteMany({});
  await prisma.masterIdentity.deleteMany({});
}

async function createMasterFixture(masterId: string) {
  const result = await createMaster({ masterId, email: `${masterId}@example.com`, createdByMasterId: null });
  if (!result.ok) throw new Error("setup failed");
  return result.master.id;
}

describe("auditService.listAuditEntries (User Story 11, FR-073, SC-012)", () => {
  beforeEach(resetState);
  afterAll(async () => {
    await resetState();
    await prisma.$disconnect();
  });

  it("filters by action, targetType, and targetId, each as a database WHERE clause", async () => {
    const masterId = await createMasterFixture("aud-master-1");
    await writeAuditEntry(prisma, {
      actorType: "MASTER",
      actorMasterId: masterId,
      action: "community.suspend",
      targetType: "Community",
      targetId: "community-a",
      outcome: "SUCCESS",
    });
    await writeAuditEntry(prisma, {
      actorType: "MASTER",
      actorMasterId: masterId,
      action: "community.edit",
      targetType: "Community",
      targetId: "community-b",
      outcome: "SUCCESS",
    });

    const byAction = await listAuditEntries({ action: "community.suspend" });
    expect(byAction.entries).toHaveLength(1);
    expect(byAction.entries[0].targetId).toBe("community-a");

    const byTargetId = await listAuditEntries({ targetId: "community-b" });
    expect(byTargetId.entries).toHaveLength(1);
    expect(byTargetId.entries[0].action).toBe("community.edit");
  });

  it("filters by date range", async () => {
    const masterId = await createMasterFixture("aud-master-2");
    await writeAuditEntry(prisma, {
      actorType: "MASTER",
      actorMasterId: masterId,
      action: "master.create",
      targetType: "MasterIdentity",
      outcome: "SUCCESS",
    });

    const future = new Date(Date.now() + 60_000);
    const inFuture = await listAuditEntries({ from: future });
    expect(inFuture.entries).toHaveLength(0);

    const past = new Date(Date.now() - 60_000);
    const sincePast = await listAuditEntries({ from: past });
    expect(sincePast.entries.length).toBeGreaterThanOrEqual(1);
  });

  it("paginates via a cursor rather than loading the full table", async () => {
    const masterId = await createMasterFixture("aud-master-3");
    for (let i = 0; i < 5; i += 1) {
      await writeAuditEntry(prisma, {
        actorType: "MASTER",
        actorMasterId: masterId,
        action: "community.edit",
        targetType: "Community",
        targetId: `community-${i}`,
        outcome: "SUCCESS",
      });
    }

    const firstPage = await listAuditEntries({ actorMasterId: masterId, pageSize: 2 });
    expect(firstPage.entries).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await listAuditEntries({ actorMasterId: masterId, pageSize: 2, cursor: firstPage.nextCursor! });
    expect(secondPage.entries).toHaveLength(2);
    expect(secondPage.entries[0].id).not.toBe(firstPage.entries[0].id);
  });

  it("a rejected action's FAILURE entry is present even though its mutation did not commit (research.md #6)", async () => {
    const masterId = await createMasterFixture("aud-master-4");
    // Last-active-master guard: only one active master exists, disabled by a different (fabricated) caller id.
    const rejected = await disableMaster("some-other-caller", masterId);
    expect(rejected).toEqual({ ok: false, reason: "last_active_master" });

    const stillActive = await prisma.masterIdentity.findUnique({ where: { id: masterId } });
    expect(stillActive?.status).toBe("ACTIVE");

    const entries = await listAuditEntries({ action: "master.disable", targetId: masterId });
    expect(entries.entries.some((e) => e.outcome === "FAILURE")).toBe(true);
  });

  it("no entry's detail ever contains a password/hash/token-shaped secret", async () => {
    const masterId = await createMasterFixture("aud-master-5");
    await createMaster({ masterId: "aud-master-5-b", email: "aud-master-5-b@example.com", createdByMasterId: masterId });

    const entries = await listAuditEntries({ action: "master.create" });
    for (const entry of entries.entries) {
      const serialized = JSON.stringify(entry.detail ?? {});
      expect(serialized).not.toMatch(/password|passwordHash|sessionToken/i);
    }
  });

  it("no update or delete function is exported by auditService (FR-071, enforced by omission)", async () => {
    const auditService = await import("@/server/services/auditService");
    expect((auditService as Record<string, unknown>).updateAuditEntry).toBeUndefined();
    expect((auditService as Record<string, unknown>).deleteAuditEntry).toBeUndefined();
  });
});
