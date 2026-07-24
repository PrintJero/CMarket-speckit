import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createMasterSession,
  getValidMasterSession,
  deleteMasterSession,
} from "@/server/services/masterSessionService";
import { createMaster } from "@/server/services/masterAuthService";

async function resetMasterState() {
  await prisma.administrativeAuditEntry.deleteMany({});
  await prisma.masterSession.deleteMany({});
  await prisma.masterIdentity.deleteMany({});
}

describe("masterSessionService (contract)", () => {
  beforeEach(resetMasterState);
  afterAll(async () => {
    await resetMasterState();
    await prisma.$disconnect();
  });

  it("creates a session and validates it, resolving the owning MASTER", async () => {
    const master = await createMaster({ masterId: "session-a", email: "session-a@example.com", createdByMasterId: null });
    if (!master.ok) throw new Error("setup failed");

    const session = await createMasterSession(master.master.id);
    const valid = await getValidMasterSession(session.sessionToken);

    expect(valid?.masterId).toBe(master.master.id);
    expect(valid?.masterIdValue).toBe("session-a");
  });

  it("treats an expired session identically to a deleted one, and cleans it up on lookup", async () => {
    const master = await createMaster({ masterId: "session-b", email: "session-b@example.com", createdByMasterId: null });
    if (!master.ok) throw new Error("setup failed");

    const session = await createMasterSession(master.master.id, undefined, new Date(Date.now() - 1000));
    expect(await getValidMasterSession(session.sessionToken)).toBeNull();

    const rawHash = createHash("sha256").update(session.sessionToken, "utf8").digest("hex");
    expect(await prisma.masterSession.findUnique({ where: { sessionTokenHash: rawHash } })).toBeNull();
  });

  it("a session for a since-DISABLED identity resolves to null", async () => {
    const master = await createMaster({ masterId: "session-c", email: "session-c@example.com", createdByMasterId: null });
    if (!master.ok) throw new Error("setup failed");

    const session = await createMasterSession(master.master.id);
    await prisma.masterIdentity.update({ where: { id: master.master.id }, data: { status: "DISABLED" } });

    expect(await getValidMasterSession(session.sessionToken)).toBeNull();
  });

  it("deleteMasterSession removes exactly that row", async () => {
    const master = await createMaster({ masterId: "session-d", email: "session-d@example.com", createdByMasterId: null });
    if (!master.ok) throw new Error("setup failed");

    const session = await createMasterSession(master.master.id);
    await deleteMasterSession(session.sessionToken);

    expect(await getValidMasterSession(session.sessionToken)).toBeNull();
  });
});
