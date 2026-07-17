import { describe, expect, it } from "vitest";
import { isValidCommunityName } from "@/lib/validation/communityName";

describe("isValidCommunityName (FR-014)", () => {
  it("rejects an empty string", () => {
    expect(isValidCommunityName("")).toBe(false);
  });

  it("rejects a whitespace-only string", () => {
    expect(isValidCommunityName("   ")).toBe(false);
  });

  it("rejects a string that is only tabs/newlines", () => {
    expect(isValidCommunityName("\t\n  \t")).toBe(false);
  });

  it("accepts a real name", () => {
    expect(isValidCommunityName("Riverside Residences")).toBe(true);
  });

  it("accepts a real name with incidental leading/trailing whitespace", () => {
    expect(isValidCommunityName("  Riverside Residences  ")).toBe(true);
  });
});
