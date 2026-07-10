import { useRouter } from 'next/router';
import { FormEvent, useState } from 'react';
import { ApiError, createInvitation } from '@/services/apiClient';

type SubmitState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'success'; inviteeEmail: string }
  | { status: 'error'; message: string };

export default function InviteMemberPage() {
  const router = useRouter();
  const communityId = typeof router.query.communityId === 'string' ? router.query.communityId : '';
  const [inviteeEmail, setInviteeEmail] = useState('');
  const [state, setState] = useState<SubmitState>({ status: 'idle' });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!communityId) return;

    setState({ status: 'submitting' });
    try {
      await createInvitation(communityId, { inviteeEmail });
      setState({ status: 'success', inviteeEmail });
      setInviteeEmail('');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to send invitation';
      setState({ status: 'error', message });
    }
  }

  return (
    <main>
      <h1>Invite a member</h1>
      <p>
        Invite a prospective member to this community by email. There is no way for someone to
        request to join on their own — every membership starts with an invitation you send.
      </p>

      <form onSubmit={handleSubmit}>
        <label htmlFor="inviteeEmail">Email address</label>
        <input
          id="inviteeEmail"
          name="inviteeEmail"
          type="email"
          required
          value={inviteeEmail}
          onChange={(e) => setInviteeEmail(e.target.value)}
        />
        <button type="submit" disabled={state.status === 'submitting'}>
          {state.status === 'submitting' ? 'Sending…' : 'Send invitation'}
        </button>
      </form>

      {state.status === 'success' && (
        <p role="status">Invitation sent to {state.inviteeEmail}.</p>
      )}
      {state.status === 'error' && <p role="alert">{state.message}</p>}
    </main>
  );
}
