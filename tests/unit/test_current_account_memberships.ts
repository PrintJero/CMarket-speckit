import { describe, expect, it } from "vitest";
import { toCurrentAccountPayload } from "@/lib/auth/currentAccount";

/** research.md #7: toCurrentAccountPayload() gains an optional, default-[] second parameter. */
describe("toCurrentAccountPayload with memberships", () => {
  it("defaults to an empty memberships list when the second argument is omitted", () => {
    const payload = toCurrentAccountPayload({
      accountId: "acc_1",
      email: "person@example.com",
      emailVerifiedAt: null,
    });
    expect(payload.memberships).toEqual([]);
  });

  it("returns the provided memberships list verbatim when the second argument is given", () => {
    const memberships = [
      { communityId: "community_1", communityName: "Acme University", role: "ADMINISTRATOR" as const },
      { communityId: "community_2", communityName: "Acme Co-op", role: "MEMBER" as const },
    ];
    const payload = toCurrentAccountPayload(
      {
        accountId: "acc_1",
        email: "person@example.com",
        emailVerifiedAt: new Date(),
      },
      memberships,
    );
    expect(payload.memberships).toEqual(memberships);
  });
});
