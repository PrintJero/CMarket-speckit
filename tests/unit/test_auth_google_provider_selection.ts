import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENABLED = process.env.GOOGLE_OAUTH_MOCK_ENABLED;
const ORIGINAL_URL = process.env.GOOGLE_OAUTH_MOCK_URL;
const MOCK_URL = "http://localhost:4310";

async function loadAuthOptions() {
  vi.resetModules();
  const mod = await import("@/lib/auth/authConfig");
  return mod.authOptions;
}

describe("authConfig.ts Google provider selection (research.md #2, behavioral guard)", () => {
  afterEach(() => {
    if (ORIGINAL_ENABLED === undefined) delete process.env.GOOGLE_OAUTH_MOCK_ENABLED;
    else process.env.GOOGLE_OAUTH_MOCK_ENABLED = ORIGINAL_ENABLED;
    if (ORIGINAL_URL === undefined) delete process.env.GOOGLE_OAUTH_MOCK_URL;
    else process.env.GOOGLE_OAUTH_MOCK_URL = ORIGINAL_URL;
  });

  it("registers the real Google provider when GOOGLE_OAUTH_MOCK_ENABLED is unset, even if GOOGLE_OAUTH_MOCK_URL happens to be set", async () => {
    delete process.env.GOOGLE_OAUTH_MOCK_ENABLED;
    process.env.GOOGLE_OAUTH_MOCK_URL = MOCK_URL;

    const authOptions = await loadAuthOptions();
    const provider = authOptions.providers[0] as unknown as {
      wellKnown?: string;
      authorization?: unknown;
      token?: unknown;
      userinfo?: unknown;
    };

    expect(provider.wellKnown).toBe("https://accounts.google.com/.well-known/openid-configuration");
    const serialized = JSON.stringify([provider.authorization, provider.token, provider.userinfo]);
    expect(serialized).not.toContain(MOCK_URL);
  });

  it("registers the mock provider pointed at GOOGLE_OAUTH_MOCK_URL when GOOGLE_OAUTH_MOCK_ENABLED is 'true'", async () => {
    process.env.GOOGLE_OAUTH_MOCK_ENABLED = "true";
    process.env.GOOGLE_OAUTH_MOCK_URL = MOCK_URL;

    const authOptions = await loadAuthOptions();
    const provider = authOptions.providers[0] as unknown as {
      wellKnown?: string;
      authorization?: { url?: string };
      token?: { url?: string };
      userinfo?: { url?: string };
    };

    expect(provider.wellKnown).toBeUndefined();
    expect(provider.authorization?.url).toContain(MOCK_URL);
    expect(provider.token?.url).toContain(MOCK_URL);
    expect(provider.userinfo?.url).toContain(MOCK_URL);
  });
});
