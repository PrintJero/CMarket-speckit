export interface InvitationEmailPayload {
  invitationId: string;
  communityId: string;
  communityName: string;
  inviteeEmail: string;
  expiresAt: Date;
}

/**
 * Thin wrapper around the existing (already-built) email-sending
 * capability. This module is the ONLY place that knows how to reach that
 * service — invitationService calls sendInvitationEmail() and never talks
 * to the email provider directly (research.md: "Email delivery integration").
 *
 * The existing capability is assumed reachable as an HTTP service at
 * EMAIL_SERVICE_BASE_URL; adjust this implementation to match its actual
 * contract once that service's interface is confirmed.
 */
export async function sendInvitationEmail(payload: InvitationEmailPayload): Promise<void> {
  const baseUrl = process.env.EMAIL_SERVICE_BASE_URL;
  if (!baseUrl) {
    throw new Error('EMAIL_SERVICE_BASE_URL is not configured');
  }

  const response = await fetch(`${baseUrl}/send-invitation-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: payload.inviteeEmail,
      templateData: {
        invitationId: payload.invitationId,
        communityId: payload.communityId,
        communityName: payload.communityName,
        expiresAt: payload.expiresAt.toISOString(),
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Email service responded with status ${response.status}`);
  }
}
