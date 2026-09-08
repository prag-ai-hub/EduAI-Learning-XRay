import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, useColorScheme, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/shared/components/themed-text';
import { Colors } from '@/shared/theme/tokens';
import { ApiError, apiConfigured, schools, type School } from '@/shared/api/django';
import { supabaseConfigured } from '@/shared/api/supabase';

/**
 * Home.
 *
 * Deliberately small: it proves the whole path end to end - Supabase session,
 * bearer token, Django API, shared client - so that everything after it is
 * screens rather than plumbing.
 */

type State =
  | { kind: 'loading' }
  | { kind: 'unconfigured'; detail: string }
  | { kind: 'signed-out' }
  | { kind: 'no-school' }
  | { kind: 'ready'; school: School }
  | { kind: 'error'; message: string };

const STATUS_TONE: Record<School['status'], 'green' | 'orange' | 'red'> = {
  Active: 'green',
  Pending: 'orange',
  Suspended: 'orange',
  Closed: 'red',
};

export default function HomeScreen() {
  const palette = Colors[useColorScheme() === 'dark' ? 'dark' : 'light'];
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let alive = true;

    void (async () => {
      if (!supabaseConfigured || !apiConfigured) {
        // A build with no backend should say so, not fail on the first tap.
        setState({
          kind: 'unconfigured',
          detail: !supabaseConfigured
            ? 'Supabase is not configured in this build.'
            : 'No analysis service is configured in this build.',
        });
        return;
      }
      try {
        const { school } = await schools.mine();
        if (!alive) return;
        setState(school ? { kind: 'ready', school } : { kind: 'no-school' });
      } catch (cause) {
        if (!alive) return;
        if (cause instanceof ApiError && cause.isAuthProblem) {
          setState({ kind: 'signed-out' });
          return;
        }
        setState({
          kind: 'error',
          message: cause instanceof ApiError ? cause.message : 'Something went wrong.',
        });
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
      <View style={styles.content}>
        <ThemedText type="title">EduAI Learning X-Ray</ThemedText>

        {state.kind === 'loading' && <ActivityIndicator color={palette.navy} />}

        {state.kind === 'unconfigured' && (
          <ThemedText style={{ color: palette.textSecondary }}>{state.detail}</ThemedText>
        )}

        {state.kind === 'signed-out' && (
          <ThemedText style={{ color: palette.textSecondary }}>
            Sign in to see your school.
          </ThemedText>
        )}

        {state.kind === 'no-school' && (
          <ThemedText style={{ color: palette.textSecondary }}>
            Your account is not linked to a school yet.
          </ThemedText>
        )}

        {state.kind === 'error' && (
          <ThemedText style={{ color: palette.red }}>{state.message}</ThemedText>
        )}

        {state.kind === 'ready' && (
          <View style={[styles.card, { backgroundColor: palette.backgroundElement, borderColor: palette.border }]}>
            <ThemedText type="subtitle">{state.school.name}</ThemedText>
            <ThemedText style={{ color: palette[STATUS_TONE[state.school.status]] }}>
              {state.school.status}
            </ThemedText>
            {state.school.city ? (
              <ThemedText type="small" style={{ color: palette.textSecondary }}>
                {[state.school.city, state.school.board].filter(Boolean).join(' · ')}
              </ThemedText>
            ) : null}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flex: 1, gap: 16, padding: 24, justifyContent: 'center' },
  card: { borderWidth: 1, borderRadius: 18, padding: 22, gap: 6 },
});
