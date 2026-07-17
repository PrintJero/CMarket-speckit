import { describe, expect, it } from "vitest";
import { authOptions } from "@/lib/auth/authConfig";
import { SESSION_COOKIE_NAME } from "@/lib/auth/sessionCookie";

describe("auth session cookie unification (FR-025, 2026-07-17 bug-fix amendment)", () => {
  it("configures Auth.js to write the same session cookie name getCurrentAccount() reads", () => {
    // Regression guard: Google sign-in previously set a cookie under Auth.js's own
    // default name while getCurrentAccount() read a differently-named cookie, so a
    // successful Google callback never resolved via getCurrentAccount() afterward.
    expect(authOptions.cookies?.sessionToken?.name).toBe(SESSION_COOKIE_NAME);
  });
});
