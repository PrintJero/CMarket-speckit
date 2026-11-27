import { afterEach, describe, expect, it, vi } from "vitest";
import { EmailDeliveryError, HttpWebhookEmailTransport } from "@/lib/email/sendEmail";

/**
 * Hotfix v1.0.1 (hotfix/email-error-detail). In production the verification
 * email failed with "Email webhook responded with status 401" and nothing
 * else: the provider's explanation in the response body (Resend: "API key is
 * invalid") was discarded. The cause was EMAIL_WEBHOOK_TOKEN pasted as
 * RESEND_API_KEY="..." in Dokploy.
 */

const TOKEN = "re_secret_token_value_123";
const MESSAGE = { to: "someone@example.com", subject: "Verify", text: "link" };

function transport() {
  return new HttpWebhookEmailTransport("https://api.resend.com/emails", TOKEN, "CMarket <a@b.c>");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HttpWebhookEmailTransport error detail", () => {
  it("reports the provider's status and response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ name: "validation_error", message: "API key is invalid" }),
            {
              status: 401,
            },
          ),
      ),
    );

    const error = await transport()
      .send(MESSAGE)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmailDeliveryError);
    const delivery = error as EmailDeliveryError;
    expect(delivery.status).toBe(401);
    expect(delivery.message).toContain("401");
    expect(delivery.message).toContain("API key is invalid");
  });

  it("never includes the token, even when the provider echoes it back", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            `Invalid key: Bearer ${TOKEN} (header was "Authorization: Bearer ${TOKEN}")`,
            {
              status: 403,
            },
          ),
      ),
    );

    const error = (await transport()
      .send(MESSAGE)
      .catch((e: unknown) => e)) as EmailDeliveryError;
    expect(error.message).not.toContain(TOKEN);
    expect(error.message).toContain("[redacted]");
  });

  it("truncates a long response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("x".repeat(5_000), { status: 500 })),
    );

    const error = (await transport()
      .send(MESSAGE)
      .catch((e: unknown) => e)) as EmailDeliveryError;
    expect(error.message.length).toBeLessThan(400);
    expect(error.message).toContain("…");
  });

  it("reports a network failure without a status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const error = (await transport()
      .send(MESSAGE)
      .catch((e: unknown) => e)) as EmailDeliveryError;
    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect(error.status).toBeNull();
    expect(error.message).toContain("fetch failed");
  });

  it("resolves on a 2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"id":"abc"}', { status: 200 })),
    );
    await expect(transport().send(MESSAGE)).resolves.toBeUndefined();
  });
});
