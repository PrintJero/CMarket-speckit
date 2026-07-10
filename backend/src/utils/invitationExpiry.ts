import { Invitation } from '@prisma/client';

export const DEFAULT_INVITATION_EXPIRY_DAYS = Number(
  process.env.DEFAULT_INVITATION_EXPIRY_DAYS ?? 7,
);

export type EffectiveInvitationStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'DECLINED'
  | 'CANCELLED'
  | 'EXPIRED';

/**
 * Computes expiresAt for a new invitation: createdAt + the community's
 * configured expiry days, falling back to the platform default (7 days)
 * when the community has no override (data-model.md: Community.invitationExpiryDays).
 */
export function computeExpiresAt(createdAt: Date, communityInvitationExpiryDays: number | null): Date {
  const days = communityInvitationExpiryDays ?? DEFAULT_INVITATION_EXPIRY_DAYS;
  const expiresAt = new Date(createdAt);
  expiresAt.setDate(expiresAt.getDate() + days);
  return expiresAt;
}

/**
 * Derives the effective status of an invitation without any stored
 * "EXPIRED" state or background job: a still-PENDING invitation whose
 * expiresAt has passed is treated as EXPIRED (FR-016, FR-017). See
 * research.md "Invitation expiration mechanism".
 */
export function computeEffectiveStatus(
  invitation: Pick<Invitation, 'status' | 'expiresAt'>,
  now: Date = new Date(),
): EffectiveInvitationStatus {
  if (invitation.status === 'PENDING' && now >= invitation.expiresAt) {
    return 'EXPIRED';
  }
  return invitation.status;
}

export function isPending(
  invitation: Pick<Invitation, 'status' | 'expiresAt'>,
  now: Date = new Date(),
): boolean {
  return computeEffectiveStatus(invitation, now) === 'PENDING';
}
