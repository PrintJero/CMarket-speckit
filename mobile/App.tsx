import React, { useState } from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';

import InviteMemberScreen from './src/screens/InviteMemberScreen';
import MyInvitationsScreen from './src/screens/MyInvitationsScreen';

// Minimal manual screen switch for now — no navigation library is wired up
// yet, since this feature only requires these two screens to exist and be
// independently testable (Constitution Principle VII: no unrequested deps).
type Screen = 'invite' | 'myInvitations';

export default function App() {
  const [screen] = useState<Screen>('myInvitations');
  const demoCommunityId = 'demo-community-id';

  return (
    <SafeAreaView style={styles.container}>
      {screen === 'invite' ? (
        <InviteMemberScreen communityId={demoCommunityId} />
      ) : (
        <MyInvitationsScreen />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
