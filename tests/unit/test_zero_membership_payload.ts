import { describe, expect, it } from "vitest";
import { toCurrentAccountPayload } from "@/lib/auth/currentAccount";

/** FR-003, FR-013: no signup method's session payload can ever carry community data. */
describe("toCurrentAccountPayload", () => {
  it("always returns an empty memberships list for an unverified account", () => {
    const payload = toCurrentAccountPayload({
      accountId: "acc_1",
      email: "person@example.com",
      emailVerifiedAt: null,
    });
    expect(payload.memberships).toEqual([]);
    expect(payload.verified).toBe(false);
  });

  it("always returns an empty memberships list for a verified (e.g. Google) account", () => {
    const payload = toCurrentAccountPayload({
      accountId: "acc_2",
      email: "person@example.com",
      emailVerifiedAt: new Date(),
    });
    expect(payload.memberships).toEqual([]);
    expect(payload.verified).toBe(true);
  });

  it("exposes only accountId, email, verified, displayName, and memberships", () => {
    const payload = toCurrentAccountPayload({
      accountId: "acc_3",
      email: "person@example.com",
      emailVerifiedAt: null,
    });
    expect(Object.keys(payload).sort()).toEqual([
      "accountId",
      "activeCommunityId",
      "displayName",
      "email",
      "memberships",
      "verified",
    ]);
  });
});
