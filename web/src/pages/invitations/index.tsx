import { useEffect, useState } from 'react';
import { acceptInvitation, ApiError, Invitation, listMyInvitations } from '@/services/apiClient';

type LoadState =
  | { status: 'loading' }
  | { status: 'loaded'; invitations: Invitation[] }
  | { status: 'error'; message: string };

export default function MyInvitationsPage() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [respondingId, setRespondingId] = useState<string | null>(null);

  useEffect(() => {
    listMyInvitations()
      .then((invitations) => setState({ status: 'loaded', invitations }))
      .catch((err) =>
        setState({
          status: 'error',
          message: err instanceof ApiError ? err.message : 'Failed to load invitations',
        }),
      );
  }, []);

  async function handleAccept(invitationId: string) {
    setRespondingId(invitationId);
    try {
      await acceptInvitation(invitationId);
      setState((prev) =>
        prev.status === 'loaded'
          ? { status: 'loaded', invitations: prev.invitations.filter((i) => i.id !== invitationId) }
          : prev,
      );
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof ApiError ? err.message : 'Failed to accept invitation',
      });
    } finally {
      setRespondingId(null);
    }
  }

  if (state.status === 'loading') return <p>Loading your invitations…</p>;
  if (state.status === 'error') return <p role="alert">{state.message}</p>;

  return (
    <main>
      <h1>My invitations</h1>
      {state.invitations.length === 0 && <p>You have no pending invitations.</p>}
      <ul>
        {state.invitations.map((invitation) => (
          <li key={invitation.id}>
            <span>Community invitation ({invitation.effectiveStatus})</span>
            <button
              type="button"
              disabled={respondingId === invitation.id}
              onClick={() => handleAccept(invitation.id)}
            >
              Accept
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
