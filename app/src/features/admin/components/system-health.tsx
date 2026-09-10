/**
 * Provider health, measured rather than claimed.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx `SystemHealthPanel`
 * (~713), and the honesty is the point of the screen: the live check makes a
 * real request to the OCR and learning-analysis services and reports what came
 * back, the session figures are computed from calls this app actually made, and
 * the closing paragraph says plainly that long-term uptime needs a monitoring
 * backend this build does not have. Nothing here is simulated, and nothing
 * should be added that is.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTE
 * ---------------------------------------------------------------------------
 * The web called `fetch("/api/system-health")`. A relative URL resolves against
 * the page on Expo web and against nothing at all on a device, so the request
 * goes through `authFetch`, which resolves the origin and attaches the token.
 */

import { useState } from 'react';
import { Text, View } from 'react-native';

import { authFetch } from '@/features/auth/api/authApi';
import { AppButton } from '@/shared/components/buttons';
import { CardHead, CardSpan2 } from '@/shared/components/primitives';
import { StatusPill } from '@/shared/components/status';
import { useAppStyles } from '@/shared/theme/styles';
import type { ApiLogEntry, W } from '@/shared/types/workspace';

/** One provider as GET /api/system-health reports it. */
type ProviderCheck = {
  provider: string;
  ok: boolean;
  ms: number;
  status?: number;
  error?: string;
};

type HealthReport = { checkedAt: string; providers: ProviderCheck[] };

/**
 * What a teacher calls each provider.
 *
 * The web branched on one comparison - `provider === "mistral" ? "OCR service"
 * : "Learning analysis"` - which now labels every future provider as the
 * analysis one. `src/app/api/system-health+api.ts` already answers with
 * `ai-proxy`, so an unrecognised provider shows its own id rather than
 * borrowing a name that is not its.
 */
const PROVIDER_LABEL: Record<string, string> = {
  mistral: 'OCR service',
  openai: 'Learning analysis',
  'ai-proxy': 'Learning analysis',
};

type ProviderStats = { count: number; successRate: number; avgMs: number };

/** Success rate and mean latency for one provider, or null when it was never called. */
function statsFor(log: ApiLogEntry[], provider: ApiLogEntry['provider']): ProviderStats | null {
  const entries = log.filter((entry) => entry.provider === provider);
  if (!entries.length) return null;
  const ok = entries.filter((entry) => entry.ok).length;
  return {
    count: entries.length,
    successRate: Math.round((ok / entries.length) * 100),
    avgMs: Math.round(entries.reduce((sum, entry) => sum + entry.ms, 0) / entries.length),
  };
}

function usageText(stats: ProviderStats | null): string {
  if (!stats) return 'No calls made yet this session';
  return `${stats.successRate}% success · ${stats.avgMs}ms avg · ${stats.count} call${stats.count === 1 ? '' : 's'}`;
}

/** `.list-item` - a label and the pill that reports on it. */
function HealthRow({ label, tone, value }: { label: string; tone: 'success' | 'warning' | 'neutral'; value: string }) {
  const s = useAppStyles();
  return (
    <View style={s.listItem}>
      <Text style={s.listItemText}>{label}</Text>
      <StatusPill tone={tone}>{value}</StatusPill>
    </View>
  );
}

export function SystemHealthPanel({ state }: W<'state'>) {
  const s = useAppStyles();
  const [checking, setChecking] = useState(false);
  const [live, setLive] = useState<HealthReport | null>(null);
  const [liveError, setLiveError] = useState('');

  const runCheck = async () => {
    setChecking(true);
    setLiveError('');
    try {
      const response = await authFetch('/api/system-health');
      const payload = (await response.json().catch(() => null)) as
        | (HealthReport & { error?: string })
        | null;
      if (!response.ok || !payload) throw new Error(payload?.error || 'Health check failed');
      setLive(payload);
    } catch (cause) {
      setLiveError(cause instanceof Error ? cause.message : 'Health check failed');
    } finally {
      setChecking(false);
    }
  };

  // A snapshot restored from an older cache predates the log, so it is not
  // assumed to be there.
  const log = state.apiLog ?? [];
  const mistral = statsFor(log, 'mistral');
  const openai = statsFor(log, 'openai');

  return (
    <CardSpan2>
      <CardHead eyebrow="System health" title="Live provider status" />
      <Text style={s.modalCopy}>
        This checks the OCR and learning-analysis services with a real request and reports what
        actually comes back — no simulated numbers.
      </Text>
      <AppButton
        title={checking ? 'Checking…' : 'Check live status now'}
        disabled={checking}
        onPress={() => void runCheck()}
      />
      {liveError ? (
        <View role="alert" style={s.formError}>
          <Text style={s.formErrorText}>{liveError}</Text>
        </View>
      ) : null}
      {live ? (
        <View>
          {live.providers.map((provider) => (
            <HealthRow
              key={provider.provider}
              label={PROVIDER_LABEL[provider.provider] ?? provider.provider}
              tone={provider.ok ? 'success' : 'warning'}
              value={
                provider.ok
                  ? `Reachable · ${provider.ms}ms`
                  : `Unreachable${provider.error ? ` · ${provider.error}` : ''}`
              }
            />
          ))}
          <Text style={s.modalCopy}>
            Checked at {new Date(live.checkedAt).toLocaleTimeString()}.
          </Text>
        </View>
      ) : null}
      <Text accessibilityRole="header" style={s.cardTitle}>
        Real usage this session
      </Text>
      <Text style={s.modalCopy}>
        Success rate and latency computed from every real grading and worksheet-generation call this
        app has actually made — not projected or simulated.
      </Text>
      <View>
        <HealthRow label="Mistral OCR" tone="neutral" value={usageText(mistral)} />
        <HealthRow label="Learning analysis" tone="neutral" value={usageText(openai)} />
      </View>
      <Text style={s.modalCopy}>
        Long-term uptime (30/90-day %) and queue depth still require a real monitoring backend with
        persistent storage across sessions — that&apos;s genuinely out of scope for this
        frontend-only build, not faked.
      </Text>
    </CardSpan2>
  );
}
