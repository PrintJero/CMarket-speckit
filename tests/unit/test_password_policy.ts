import { describe, expect, it } from "vitest";
import { MIN_PASSWORD_LENGTH, validatePassword } from "@/lib/validation/password";

describe("validatePassword (FR-016)", () => {
  it("rejects a password shorter than 8 characters", async () => {
    const result = await validatePassword("short12", { checkBreached: async () => false });
    expect(result).toEqual({ valid: false, reason: "too_short" });
  });

  it("accepts an 8-character password that is not breached", async () => {
    const result = await validatePassword("abcdefgh", { checkBreached: async () => false });
    expect(result).toEqual({ valid: true });
  });

  it("rejects a password found on the breached list, even if long enough", async () => {
    const result = await validatePassword("password123", { checkBreached: async () => true });
    expect(result).toEqual({ valid: false, reason: "breached" });
  });

  it("does not require any character-class mix beyond length + breach check", async () => {
    const result = await validatePassword("aaaaaaaa", { checkBreached: async () => false });
    expect(result.valid).toBe(true);
  });

  it("exposes the minimum length as 8", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
  });
});
