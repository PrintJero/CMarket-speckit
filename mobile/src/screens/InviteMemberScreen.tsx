import React, { useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError, createInvitation } from '../services/apiClient';

interface Props {
  communityId: string;
}

type SubmitState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'success'; inviteeEmail: string }
  | { status: 'error'; message: string };

export default function InviteMemberScreen({ communityId }: Props) {
  const [inviteeEmail, setInviteeEmail] = useState('');
  const [state, setState] = useState<SubmitState>({ status: 'idle' });

  async function handleSubmit() {
    if (!inviteeEmail) return;
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
    <View style={styles.container}>
      <Text style={styles.title}>Invite a member</Text>
      <Text style={styles.body}>
        Invite a prospective member to this community by email. There is no way for someone to
        request to join on their own — every membership starts with an invitation you send.
      </Text>
      <TextInput
        style={styles.input}
        placeholder="Email address"
        keyboardType="email-address"
        autoCapitalize="none"
        value={inviteeEmail}
        onChangeText={setInviteeEmail}
      />
      <Button
        title={state.status === 'submitting' ? 'Sending…' : 'Send invitation'}
        onPress={handleSubmit}
        disabled={state.status === 'submitting'}
      />
      {state.status === 'submitting' && <ActivityIndicator />}
      {state.status === 'success' && <Text>Invitation sent to {state.inviteeEmail}.</Text>}
      {state.status === 'error' && <Text style={styles.error}>{state.message}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 8 },
  body: { marginBottom: 16 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 4,
    padding: 8,
    marginBottom: 12,
  },
  error: { color: 'red', marginTop: 8 },
});
