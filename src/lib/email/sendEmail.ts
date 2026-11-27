export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailTransport {
  send(message: EmailMessage): Promise<void>;
}

/**
 * Dev/test transport: no external dependency, no network call. Used whenever
 * no webhook provider is configured (research.md #5: this feature must not
 * depend on which provider is chosen).
 */
export class ConsoleEmailTransport implements EmailTransport {
  async send(message: EmailMessage): Promise<void> {
    console.log(
      `[email:dev] to=${message.to} subject=${JSON.stringify(message.subject)}\n${message.text}`,
    );
  }
}

/**
 * A message could not be delivered to the email provider. `status` is the
 * provider's HTTP status, or null when the request never got a response
 * (DNS, TLS, timeout). The message carries the provider's explanation,
 * truncated and with the credential redacted, for the SERVER LOG only. It is
 * never returned to the browser.
 */
export class EmailDeliveryError extends Error {
  constructor(
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}

/**
 * What the member sees when a verification email could not be sent: says what
 * happened and that retrying is safe. Never includes provider detail.
 */
export const EMAIL_DELIVERY_FAILED_MESSAGE =
  "We couldn't send the verification email right now. Nothing was lost — please try again in a few minutes.";

const MAX_PROVIDER_DETAIL_CHARS = 300;

/** Removes the credential (and any bearer value) from provider-supplied text. */
function redact(text: string, token: string | undefined): string {
  let safe = text.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  if (token) safe = safe.split(token).join("[redacted]");
  return safe;
}

function truncate(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_PROVIDER_DETAIL_CHARS
    ? `${oneLine.slice(0, MAX_PROVIDER_DETAIL_CHARS)}…`
    : oneLine;
}

/**
 * Generic HTTP transport: POSTs the message as JSON to any provider-agnostic
 * webhook (e.g. a small function that forwards to whichever transactional
 * email vendor is chosen at deploy time). Uses only the platform `fetch` —
 * no vendor SDK dependency.
 */
export class HttpWebhookEmailTransport implements EmailTransport {
  constructor(
    private readonly webhookUrl: string,
    private readonly token: string | undefined,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    let response: Response;
    try {
      response = await fetch(this.webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify({ from: this.from, ...message }),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new EmailDeliveryError(
        null,
        `Email webhook request failed: ${truncate(redact(reason, this.token))}`,
      );
    }

    if (!response.ok) {
      // The provider's body says WHY (e.g. Resend: "API key is invalid").
      // Keep it, bounded and with the credential removed.
      const body = await response.text().catch(() => "");
      const detail = body ? `: ${truncate(redact(body, this.token))}` : "";
      throw new EmailDeliveryError(
        response.status,
        `Email webhook responded with status ${response.status}${detail}`,
      );
    }
  }
}

const capturedEmails: EmailMessage[] = [];

/**
 * Test-sink transport (quickstart.md's "local inbox catcher"): captures
 * messages in memory instead of sending them anywhere, so integration tests
 * driving a real running server can retrieve a verification link without a
 * real mailbox. Only ever active when EMAIL_TEST_CAPTURE=true — never set in
 * a real deployment.
 */
class CapturingEmailTransport implements EmailTransport {
  async send(message: EmailMessage): Promise<void> {
    capturedEmails.push(message);
  }
}

export function getCapturedEmails(to: string): EmailMessage[] {
  return capturedEmails.filter((m) => m.to.toLowerCase() === to.toLowerCase());
}

export function clearCapturedEmails(): void {
  capturedEmails.length = 0;
}

function resolveTransport(): EmailTransport {
  if (process.env.EMAIL_TEST_CAPTURE === "true") {
    return new CapturingEmailTransport();
  }
  const webhookUrl = process.env.EMAIL_WEBHOOK_URL;
  if (webhookUrl) {
    return new HttpWebhookEmailTransport(
      webhookUrl,
      process.env.EMAIL_WEBHOOK_TOKEN,
      process.env.EMAIL_FROM ?? "CMarket <no-reply@cmarket.example>",
    );
  }
  return new ConsoleEmailTransport();
}

let cachedTransport: EmailTransport | undefined;

export async function sendEmail(message: EmailMessage): Promise<void> {
  cachedTransport ??= resolveTransport();
  await cachedTransport.send(message);
}

/** Test-only hook to inject a fake transport and reset the cache. */
export function __setEmailTransportForTests(transport: EmailTransport | undefined): void {
  cachedTransport = transport;
}
