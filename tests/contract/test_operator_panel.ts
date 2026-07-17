import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST as createCommunityRoute } from "../../app/api/operator/create-community/route";

const ORIGINAL_ENV = process.env.OPERATOR_PANEL_ENABLED;

function postRequest(body: unknown) {
  return new Request("http://localhost/api/operator/create-community", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createVerifiedAccount(email: string) {
  return prisma.account.create({
    data: { email, passwordHash: "irrelevant-hash", emailVerifiedAt: new Date() },
  });
}

function createUnverifiedAccount(email: string) {
  return prisma.account.create({ data: { email, passwordHash: null, emailVerifiedAt: null } });
}

describe("POST /api/operator/create-community (contract, FR-016)", () => {
  beforeEach(async () => {
    await prisma.community.deleteMany({
      where: { name: { contains: "Operator Panel Test Community" } },
    });
    await prisma.account.deleteMany({ where: { email: { contains: "operator-panel" } } });
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.OPERATOR_PANEL_ENABLED;
    else process.env.OPERATOR_PANEL_ENABLED = ORIGINAL_ENV;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns 404 when OPERATOR_PANEL_ENABLED is unset, without ever calling createCommunity", async () => {
    delete process.env.OPERATOR_PANEL_ENABLED;

    const response = await createCommunityRoute(
      postRequest({
        name: "Operator Panel Test Community Zero",
        founderEmail: "operator-panel-irrelevant@example.com",
        invokedBy: "test-operator",
      }),
    );

    expect(response.status).toBe(404);
    expect(
      await prisma.community.findFirst({ where: { name: "Operator Panel Test Community Zero" } }),
    ).toBeNull();
  });

  it("returns 404 when OPERATOR_PANEL_ENABLED is set to a non-'true' value", async () => {
    process.env.OPERATOR_PANEL_ENABLED = "false";

    const response = await createCommunityRoute(
      postRequest({
        name: "Operator Panel Test Community Zero",
        founderEmail: "operator-panel-irrelevant@example.com",
        invokedBy: "test-operator",
      }),
    );

    expect(response.status).toBe(404);
  });

  it("creates a community and returns its id when enabled, for a valid verified account", async () => {
    process.env.OPERATOR_PANEL_ENABLED = "true";
    const founder = await createVerifiedAccount("operator-panel-founder-1@example.com");

    const response = await createCommunityRoute(
      postRequest({
        name: "Operator Panel Test Community One",
        founderEmail: founder.email,
        invokedBy: "test-operator",
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.community.name).toBe("Operator Panel Test Community One");

    const community = await prisma.community.findUnique({ where: { id: body.community.id } });
    expect(community).not.toBeNull();
    const membership = await prisma.membership.findFirst({
      where: { communityId: body.community.id, accountId: founder.id },
    });
    expect(membership?.role).toBe("ADMINISTRATOR");
  });

  it("surfaces invalid_name when enabled", async () => {
    process.env.OPERATOR_PANEL_ENABLED = "true";
    const founder = await createVerifiedAccount("operator-panel-founder-2@example.com");

    const response = await createCommunityRoute(
      postRequest({ name: "   ", founderEmail: founder.email, invokedBy: "test-operator" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, reason: "invalid_name" });
  });

  it("surfaces account_not_found when enabled", async () => {
    process.env.OPERATOR_PANEL_ENABLED = "true";

    const response = await createCommunityRoute(
      postRequest({
        name: "Operator Panel Test Community Two",
        founderEmail: "operator-panel-nonexistent@example.com",
        invokedBy: "test-operator",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, reason: "account_not_found" });
  });

  it("surfaces account_not_verified when enabled", async () => {
    process.env.OPERATOR_PANEL_ENABLED = "true";
    const unverified = await createUnverifiedAccount("operator-panel-unverified@example.com");

    const response = await createCommunityRoute(
      postRequest({
        name: "Operator Panel Test Community Three",
        founderEmail: unverified.email,
        invokedBy: "test-operator",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, reason: "account_not_verified" });
  });
});
