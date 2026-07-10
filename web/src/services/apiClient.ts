// Typed REST client for the shared CMarket backend API, matching
// specs/001-community-invitations/contracts/invitations-api.yaml. This is
// the ONLY place the web app talks to the backend — no invitation/membership
// business logic is reimplemented here, just request/response shaping.

export type InvitationEffectiveStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED';

export interface Invitation {
  id: string;
  communityId: string;
  inviteeEmail: string | null;
  inviteePhone: string | null;
  effectiveStatus: InvitationEffectiveStatus;
  createdAt: string;
  expiresAt: string;
  respondedAt: string | null;
}

export interface Membership {
  userId: string;
  communityId: string;
  role: 'ADMIN' | 'MEMBER';
  status: 'ACTIVE' | 'REVOKED';
  joinedAt: string;
}

export interface CreateInvitationRequest {
  inviteeEmail?: string;
  inviteePhone?: string;
}

export interface AcceptInvitationResponse {
  invitation: Invitation;
  membership: Membership;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getBaseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ code: 'UNKNOWN', message: response.statusText }));
    throw new ApiError(response.status, body.code ?? 'UNKNOWN', body.message ?? response.statusText);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export function createInvitation(
  communityId: string,
  payload: CreateInvitationRequest,
): Promise<Invitation> {
  return request<Invitation>(`/communities/${communityId}/invitations`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function listCommunityInvitations(communityId: string): Promise<Invitation[]> {
  return request<Invitation[]>(`/communities/${communityId}/invitations`);
}

export function listMyInvitations(): Promise<Invitation[]> {
  return request<Invitation[]>('/users/me/invitations');
}

export function acceptInvitation(invitationId: string): Promise<AcceptInvitationResponse> {
  return request<AcceptInvitationResponse>(`/invitations/${invitationId}/accept`, { method: 'POST' });
}

export function declineInvitation(invitationId: string): Promise<Invitation> {
  return request<Invitation>(`/invitations/${invitationId}/decline`, { method: 'POST' });
}

export function cancelInvitation(communityId: string, invitationId: string): Promise<void> {
  return request<void>(`/communities/${communityId}/invitations/${invitationId}`, { method: 'DELETE' });
}

export function listCommunityMembers(communityId: string): Promise<Membership[]> {
  return request<Membership[]>(`/communities/${communityId}/members`);
}

export function revokeMember(communityId: string, userId: string): Promise<void> {
  return request<void>(`/communities/${communityId}/members/${userId}`, { method: 'DELETE' });
}
