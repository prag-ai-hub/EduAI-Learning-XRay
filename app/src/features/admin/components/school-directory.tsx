/**
 * The cross-school directory: every tenant on the platform, and the four
 * lifecycle verbs an operator can apply to one.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx `SchoolDirectory` (~794).
 *
 * This is the one screen served by the Django REST service rather than by the
 * workspace snapshot, because these are platform rows and not this tenant's:
 * `GET /api/v1/schools/` lists them and `POST /api/v1/schools/{id}/{verb}/`
 * moves one. The client comes from `@/shared/api/django`, which is the only
 * place the service's base URL and token live.
 *
 * A rejection, suspension or reactivation needs a written reason: the school is
 * told what happened, and the audit trail has to show that a person judged.
 * Approval needs none - it grants what was already asked for.
 *
 * `SCHOOL_STATUS_TONE` is imported rather than declared. It used to be defined
 * both here and in the shared status kit, and two copies of a colour mapping
 * drift.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTE
 * ---------------------------------------------------------------------------
 * `window.setTimeout` becomes the global `setTimeout`: there is no `window` on
 * a device, and the debounce is the reason the server-side search is not a
 * request per keystroke.
 *
 * The query string is assembled by hand rather than with `URLSearchParams`,
 * which is not guaranteed on the native runtime. `encodeURIComponent` produces
 * the same thing for these two values, bar the encoding of a space, which the
 * service decodes identically.
 */

import { useCallback, useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { api, ApiError } from '@/shared/api/django';
import { AppButton, ButtonRow } from '@/shared/components/buttons';
import { CardHead, CardSpan2 } from '@/shared/components/primitives';
import { FilterChips, SCHOOL_STATUS_TONE, StatusPill } from '@/shared/components/status';
import { useAppPalette, useAppStyles } from '@/shared/theme/styles';
import type { DirectorySchool, W } from '@/shared/types/workspace';

export const SCHOOL_FILTERS = ['All', 'Pending', 'Active', 'Suspended', 'Closed'] as const;

type SchoolFilter = (typeof SCHOOL_FILTERS)[number];

/**
 * Only these transitions exist. The API validates them again - this is the
 * affordance, not the rule.
 */
export const SCHOOL_ACTIONS: Record<string, { verb: string; label: string; needsReason: boolean }[]> =
  {
    Pending: [
      { verb: 'approve', label: 'Approve', needsReason: false },
      { verb: 'reject', label: 'Reject', needsReason: true },
    ],
    Active: [{ verb: 'suspend', label: 'Suspend', needsReason: true }],
    Suspended: [{ verb: 'reactivate', label: 'Reactivate', needsReason: true }],
    Closed: [],
  };

/** What the toast says a verb did. */
const VERB_DONE: Record<string, string> = {
  approve: 'approved',
  reject: 'rejected',
  suspend: 'suspended',
  reactivate: 'reactivated',
};

/** The shortest reason the confirm button will accept, in characters. */
const MIN_REASON = 10;

export function SchoolDirectory({ notify }: W<'notify'>) {
  const s = useAppStyles();
  const p = useAppPalette();
  const [rows, setRows] = useState<DirectorySchool[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<SchoolFilter>('All');
  const [search, setSearch] = useState('');
  const [asking, setAsking] = useState<{ id: string; verb: string; label: string } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (nextFilter: string, nextSearch: string) => {
    setError('');
    try {
      const query: string[] = [];
      if (nextFilter !== 'All') query.push(`status=${encodeURIComponent(nextFilter)}`);
      if (nextSearch.trim()) query.push(`search=${encodeURIComponent(nextSearch.trim())}`);
      const suffix = query.length ? `?${query.join('&')}` : '';
      const payload = await api.get<{ results: DirectorySchool[] }>(`/api/v1/schools/${suffix}`);
      setRows(payload.results);
    } catch (cause) {
      setRows([]);
      setError(cause instanceof ApiError ? cause.message : 'The school directory is unavailable.');
    }
  }, []);

  // Debounced: the directory is a server-side search, so a request per
  // keystroke would be a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setRows(null);
      void load(filter, search);
    }, 280);
    return () => clearTimeout(timer);
  }, [filter, search, load]);

  const act = async (school: DirectorySchool, verb: string, withReason: string | null) => {
    setBusy(true);
    try {
      await api.post(
        `/api/v1/schools/${encodeURIComponent(school.id)}/${verb}/`,
        withReason === null ? {} : { reason: withReason },
      );
      notify(`${school.name} ${VERB_DONE[verb] ?? verb}.`);
      setAsking(null);
      setReason('');
      await load(filter, search);
    } catch (cause) {
      const message =
        cause instanceof ApiError ? cause.message : 'That action could not be completed.';
      setError(message);
      notify(message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const refresh = () => {
    setRows(null);
    void load(filter, search);
  };

  return (
    <CardSpan2>
      <CardHead eyebrow="Platform" title="Schools">
        <ButtonRow>
          <TextInput
            style={[s.compactInput, { minWidth: 190 }]}
            placeholder="Search name, city, board or id"
            placeholderTextColor={p.muted}
            accessibilityLabel="Search schools"
            value={search}
            onChangeText={setSearch}
          />
          <AppButton title="Refresh" onPress={refresh} />
        </ButtonRow>
      </CardHead>

      <FilterChips
        options={SCHOOL_FILTERS}
        value={filter}
        onChange={setFilter}
        accessibilityLabel="Filter schools by status"
      />

      {error ? (
        <View role="alert" style={s.formError}>
          <Text style={s.formErrorText}>{error}</Text>
        </View>
      ) : null}

      {rows === null && !error ? (
        <View role="status" style={s.insight}>
          <Text style={s.insightText}>Loading schools…</Text>
        </View>
      ) : null}

      {rows !== null && rows.length === 0 && !error ? (
        <View style={s.listItem}>
          <Text style={s.listItemText}>
            {search.trim() ? `No schools match “${search.trim()}”` : 'No schools with this status'}
          </Text>
          <StatusPill tone="neutral">Empty</StatusPill>
        </View>
      ) : null}

      {rows !== null && rows.length > 0 ? (
        <View style={s.userTable}>
          {rows.map((school) => (
            <View style={s.userRow} key={school.id}>
              <View style={[s.fileIcon, s.userRowAvatar]}>
                <Text style={s.fileIconText}>{school.name.slice(0, 2).toUpperCase()}</Text>
              </View>
              <View style={s.userRowIdentity}>
                <Text style={s.userRowName}>{school.name}</Text>
                <Text style={s.userRowCaption}>
                  {[school.city, school.board].filter(Boolean).join(' · ') ||
                    'No location recorded'}
                  {typeof school.user_count === 'number'
                    ? ` · ${school.user_count} staff · ${school.student_count} students`
                    : ''}
                </Text>
              </View>
              <View style={s.userRowCell}>
                <StatusPill tone={SCHOOL_STATUS_TONE[school.status] ?? 'neutral'}>
                  {school.status}
                </StatusPill>
              </View>
              <View style={s.userRowCell}>
                <Text style={s.userRowCaption}>
                  {new Date(school.created_at).toLocaleDateString()}
                </Text>
              </View>
              <View style={s.userRowActions}>
                {asking?.id === school.id ? (
                  <ButtonRow>
                    <TextInput
                      style={[s.compactInput, { minWidth: 190 }]}
                      accessibilityLabel={`Reason to ${asking.label.toLowerCase()} ${school.name}`}
                      placeholder="Reason (shown to the school)"
                      placeholderTextColor={p.muted}
                      value={reason}
                      onChangeText={setReason}
                    />
                    <AppButton
                      variant="primary"
                      title={busy ? 'Working…' : `Confirm ${asking.label.toLowerCase()}`}
                      disabled={busy || reason.trim().length < MIN_REASON}
                      onPress={() => void act(school, asking.verb, reason.trim())}
                    />
                    <AppButton
                      title="Cancel"
                      onPress={() => {
                        setAsking(null);
                        setReason('');
                      }}
                    />
                  </ButtonRow>
                ) : (
                  <ButtonRow>
                    {(SCHOOL_ACTIONS[school.status] || []).map((option) => (
                      <AppButton
                        key={option.verb}
                        title={option.label}
                        disabled={busy}
                        onPress={() => {
                          if (option.needsReason) {
                            setAsking({ id: school.id, verb: option.verb, label: option.label });
                            setReason('');
                            return;
                          }
                          void act(school, option.verb, null);
                        }}
                      />
                    ))}
                  </ButtonRow>
                )}
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </CardSpan2>
  );
}
