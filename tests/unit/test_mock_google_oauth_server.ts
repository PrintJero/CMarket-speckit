import { describe, expect, it } from "vitest";
import {
  buildAuthorizeRedirect,
  handleTokenRequest,
  handleUserinfoRequest,
  setMockProfile,
} from "../../scripts/mock-google-oauth-server";

describe("mock Google OAuth server request handlers (research.md #2)", () => {
  it("buildAuthorizeRedirect redirects to the caller's redirect_uri with a fixed code and the given state echoed back", () => {
    const result = buildAuthorizeRedirect({
      redirectUri: "http://localhost:3000/api/auth/callback/google",
      state: "caller-state-abc123",
    });

    const location = new URL(result.location);
    expect(location.origin + location.pathname).toBe(
      "http://localhost:3000/api/auth/callback/google",
    );
    expect(location.searchParams.get("state")).toBe("caller-state-abc123");
    expect(location.searchParams.get("code")).toBeTruthy();
  });

  it("handleTokenRequest returns a fixed access-token JSON shape", () => {
    const token = handleTokenRequest();

    expect(typeof token.access_token).toBe("string");
    expect(token.access_token.length).toBeGreaterThan(0);
    expect(token.token_type).toBe("bearer");
    expect(typeof token.expires_in).toBe("number");
  });

  it("handleUserinfoRequest returns the configured fixture profile for a given access token", () => {
    const token = handleTokenRequest();
    setMockProfile({
      sub: "mock-google-1",
      email: "ada@example.com",
      email_verified: true,
      name: "Ada Lovelace",
    });

    expect(handleUserinfoRequest(token.access_token)).toEqual({
      sub: "mock-google-1",
      email: "ada@example.com",
      email_verified: true,
      name: "Ada Lovelace",
    });
  });

  it("handleUserinfoRequest supports a fixture profile with no name (Edge Cases)", () => {
    const token = handleTokenRequest();
    setMockProfile({
      sub: "mock-google-2",
      email: "noname@example.com",
      email_verified: true,
    });

    const profile = handleUserinfoRequest(token.access_token);
    expect(profile?.name).toBeUndefined();
    expect(profile?.email).toBe("noname@example.com");
  });

  it("handleUserinfoRequest returns null for an unrecognized access token", () => {
    expect(handleUserinfoRequest("not-a-real-token")).toBeNull();
  });
});
