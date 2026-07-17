import http from "node:http";
import { URL, pathToFileURL } from "node:url";

/**
 * A standalone stand-in for Google's own OAuth endpoints, used only by
 * Playwright's test suite (research.md #2). Never started by `npm run
 * build`/`next build`/`next start` — only a second Playwright `webServer`
 * entry runs this file directly. Request-handling logic is exported as
 * plain functions so tests/unit/test_mock_google_oauth_server.ts can call
 * them without binding a real port; `main()` below binds a port only when
 * this file is the actual process entry point.
 */

const FIXED_CODE = "mock-authorization-code";
const FIXED_ACCESS_TOKEN = "mock-access-token";

export interface MockProfile {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
}

let currentProfile: MockProfile | null = null;

/** Test-only control hook: sets the profile the next /userinfo request returns. */
export function setMockProfile(profile: MockProfile | null): void {
  currentProfile = profile;
}

export function buildAuthorizeRedirect(params: { redirectUri: string; state: string }): {
  location: string;
} {
  const location = new URL(params.redirectUri);
  location.searchParams.set("code", FIXED_CODE);
  location.searchParams.set("state", params.state);
  return { location: location.toString() };
}

export function handleTokenRequest(): {
  access_token: string;
  token_type: string;
  expires_in: number;
} {
  return { access_token: FIXED_ACCESS_TOKEN, token_type: "bearer", expires_in: 3600 };
}

export function handleUserinfoRequest(accessToken: string): MockProfile | null {
  if (accessToken !== FIXED_ACCESS_TOKEN) return null;
  return currentProfile;
}

function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function createMockGoogleOAuthServer(): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/") {
      // Playwright's webServer readiness check expects a 2xx from this URL.
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("mock-google-oauth-server");
      return;
    }

    if (req.method === "GET" && url.pathname === "/authorize") {
      const redirectUri = url.searchParams.get("redirect_uri") ?? "";
      const state = url.searchParams.get("state") ?? "";
      const { location } = buildAuthorizeRedirect({ redirectUri, state });
      res.writeHead(302, { Location: location });
      res.end();
      return;
    }

    if (req.method === "POST" && url.pathname === "/token") {
      await readBody(req);
      const token = handleTokenRequest();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(token));
      return;
    }

    if (req.method === "GET" && url.pathname === "/userinfo") {
      const authHeader = req.headers.authorization ?? "";
      const accessToken = authHeader.replace(/^Bearer\s+/i, "");
      const profile = handleUserinfoRequest(accessToken);
      if (!profile) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_token" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(profile));
      return;
    }

    if (req.method === "POST" && url.pathname === "/_test/set-profile") {
      const body = await readBody(req);
      setMockProfile(JSON.parse(body) as MockProfile);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404);
    res.end();
  });
}

function main(): void {
  const url = new URL(process.env.GOOGLE_OAUTH_MOCK_URL ?? "http://localhost:4310");
  const port = Number(url.port) || 4310;
  const server = createMockGoogleOAuthServer();
  server.listen(port, () => {
    console.log(`Mock Google OAuth server listening on ${url.origin}`);
  });
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main();
}
