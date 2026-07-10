import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Button, FlatList, StyleSheet, Text, View } from 'react-native';

import { acceptInvitation, ApiError, Invitation, listMyInvitations } from '../services/apiClient';

type LoadState =
  | { status: 'loading' }
  | { status: 'loaded'; invitations: Invitation[] }
  | { status: 'error'; message: string };

export default function MyInvitationsScreen() {
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

  if (state.status === 'loading') {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>{state.message}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>My invitations</Text>
      {state.invitations.length === 0 && <Text>You have no pending invitations.</Text>}
      <FlatList
        data={state.invitations}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text>Community invitation ({item.effectiveStatus})</Text>
            <Button
              title="Accept"
              disabled={respondingId === item.id}
              onPress={() => handleAccept(item.id)}
            />
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, flex: 1 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 8 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  error: { color: 'red' },
});
