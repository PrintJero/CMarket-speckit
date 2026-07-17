import { describe, expect, it } from "vitest";
import { DISPLAY_NAME_PLACEHOLDER, resolveDisplayName } from "@/lib/formatting/displayName";

describe("display name resolution (FR-011)", () => {
  it("returns the defined placeholder when the account has no display name", () => {
    expect(resolveDisplayName(null)).toBe(DISPLAY_NAME_PLACEHOLDER);
  });

  it("returns the display name unchanged when present", () => {
    expect(resolveDisplayName("Ada")).toBe("Ada");
  });

  it("the placeholder never reveals contact information", () => {
    expect(DISPLAY_NAME_PLACEHOLDER).not.toMatch(/@/);
  });
});
