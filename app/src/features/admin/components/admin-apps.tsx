/**
 * The three non-teacher workspaces: what a school administrator, a principal
 * and a platform operator see for each module in their sidebar.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx `SchoolAdminApp` (~688),
 * `PrincipalApp` (~700) and `PlatformApp` (~759).
 *
 * These are switchboards, not screens. Wherever the monolith rendered a named
 * component for a module, this file renders the ported one and nothing else -
 * `StudentsView` and `Reports` from the teacher slice, `SchoolPerformanceMatrix`
 * from the shared kit, `SystemHealthPanel` and `SchoolDirectory` from this
 * slice. Only the JSX the monolith wrote inline for a module is ported here:
 * the administrator's overview, user table, class lists, academic years and
 * branding grid; the principal's overview; the platform's control grid.
 *
 * Authority is exactly what the web had, and no wider. Every figure on the
 * principal and platform overviews is derived from `state`, which is the
 * signed-in user's own workspace snapshot - the platform's "Active schools"
 * metric is captioned "This tenant" for that reason. The only cross-school read
 * is the Schools module, and it is `SchoolDirectory`, which asks the Django
 * service; that service decides what an operator may see. Nothing here reaches
 * into another tenant's students or work, so no support-access grant is
 * involved, and none should be bypassed by adding such a read here.
 *
 * The administrator's Students and Reports modules keep their own page heading
 * under the switchboard's, as the web did - both ported pages carry a
 * `PageHead`, and the monolith rendered one above them regardless. The
 * principal's Reports module, by contrast, returned early and showed only one.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTE
 * ---------------------------------------------------------------------------
 * `.metric-grid` is a horizontal scroll strip below 760px. `metricTrack` holds
 * the wrapping-row half of that; the scrolling half has to be a real
 * ScrollView, as it is on the teacher's Achievements screen.
 *
 * `PrincipalApp` returned `<Reports/>` before computing anything. The overview
 * reads the theme and the window size through hooks, and a component that
 * returns before its hooks on one render and after them on the next breaks the
 * rules of hooks, so the overview is its own component and the switchboard
 * only chooses between the two.
 *
 * A bare `.list-item button` was borderless navy text at the row's 10px size,
 * which is `listItemAction`; it is a Pressable around that text rather than
 * `LinkButton`, whose `.link` is 12px with a 40px floor.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';

import { authFetch } from '@/features/auth/api/authApi';
import { SchoolBilling } from '@/features/billing/components/school-billing';
import { SchoolDirectory } from '@/features/admin/components/school-directory';
import { SystemHealthPanel } from '@/features/admin/components/system-health';
import {
  ApiError,
  deleteClass,
  listClasses,
  listStudents,
  type SchoolClass,
} from '@/features/roster/api/rosterApi';
import { mirrorClasses, mirrorStudents } from '@/features/roster/lib/workspace-mirror';
import { Reports } from '@/features/teacher/components/reports';
import { StudentsView } from '@/features/teacher/components/students';
import {
  allGradeResults,
  conceptMastery,
  masteryTrend,
  overallMastery,
} from '@/features/workspace/lib/analytics';
import { AppButton, ButtonRow, LinkButton } from '@/shared/components/buttons';
import { SchoolPerformanceMatrix } from '@/shared/components/performance-matrix';
import { Card, CardHead, CardSpan2, Metric, PageHead } from '@/shared/components/primitives';
import { StatusPill } from '@/shared/components/status';
import { layoutFor, useAppStyles } from '@/shared/theme/styles';
import type {
  Assessment,
  DemoState,
  DialogName,
  Intervention,
  User,
  W,
} from '@/shared/types/workspace';

// ---------------------------------------------------------------------------
// The pieces all three workspaces are built from
// ---------------------------------------------------------------------------

/**
 * `<section className="metric-grid">` of four `Metric`s.
 *
 * Each item is `[label, value, note]`; the wrapping is done here so the three
 * overviews cannot drift apart on how a phone scrolls them.
 */
function MetricStrip({ items }: { items: readonly (readonly [string, string, string])[] }) {
  const s = useAppStyles();
  const { width } = useWindowDimensions();
  const metrics = items.map(([label, value, note]) => (
    <View key={label} style={s.metricTrack}>
      <Metric label={label} value={value} note={note} />
    </View>
  ));

  if (layoutFor(width) === 'compact')
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.metricGrid}>
        {metrics}
      </ScrollView>
    );
  return <View style={s.metricGrid}>{metrics}</View>;
}

/** `.admin-actions > button` - a bold title over a muted caption. */
function AdminAction({
  title,
  caption,
  onPress,
}: {
  title: string;
  caption: string;
  onPress: () => void;
}) {
  const s = useAppStyles();
  return (
    <Pressable
      role="button"
      accessibilityLabel={`${title}. ${caption}`}
      onPress={onPress}
      style={({ hovered, pressed }) => [
        s.adminAction,
        s.adminActionsTrack,
        (hovered || pressed) && s.adminActionHover,
      ]}>
      <Text style={s.adminActionTitle}>{title}</Text>
      <Text style={s.adminActionCaption}>{caption}</Text>
    </Pressable>
  );
}

/** `.list-item button` - the borderless navy action at the end of a list row. */
function ListItemAction({
  title,
  label,
  onPress,
}: {
  title: string;
  label?: string;
  onPress: () => void;
}) {
  const s = useAppStyles();
  return (
    <Pressable role="button" accessibilityLabel={label ?? title} onPress={onPress}>
      <Text style={s.listItemAction}>{title}</Text>
    </Pressable>
  );
}

/** "Priya Nair" -> "PN". The web took each word's first letter and kept two. */
function initialsOf(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2);
}

/**
 * The message the API sent, or the fallback.
 *
 * The web read `(await response.json()).error` unguarded, so a gateway that
 * answered with HTML threw inside the handler and the toast never appeared.
 * `InviteDialog` tolerates the parse for the same reason.
 */
async function apiMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error || fallback;
}

// ---------------------------------------------------------------------------
// The two roster panels
//
// Both read Django (`/api/v1/schools/classes/` and `/api/v1/schools/students/`)
// and then mirror what came back into the workspace snapshot. The mirror is a
// cache, not a second source of truth - `@/features/roster/lib/workspace-mirror`
// says why it still exists and which unported screens depend on it.
//
// They are components rather than inline JSX for the reason `PrincipalOverview`
// is: the switchboard renders one module of many, and a hook that runs only on
// some renders breaks the rules of hooks.
// ---------------------------------------------------------------------------

/** Neither panel refetches on a failure loop; both say why instead. */
function PanelError({ message }: { message: string }) {
  const s = useAppStyles();
  return (
    <View role="alert" style={s.formError}>
      <Text style={s.formErrorText}>{message}</Text>
    </View>
  );
}

function PanelStatus({ message }: { message: string }) {
  const s = useAppStyles();
  return (
    <View role="status" style={s.insight}>
      <Text style={s.insightText}>{message}</Text>
    </View>
  );
}

/**
 * The school's real classes, with the teacher and the roster count the server
 * holds, and the one destructive action there is.
 *
 * `label` is rendered as the server formatted it. Rebuilding "Class 6C ·
 * Mathematics" from its parts here is how two spellings of one class end up on
 * one screen.
 *
 * Deleting asks first, in the row, the way the school directory's reasoned
 * actions do - there is no dialog to open for it, and a single tap is not
 * enough for something a school can only undo by re-creating the class. The
 * server refuses anyway while students are attached, and counts them in the
 * message, so the refusal is worth showing rather than pre-empting.
 */
function ClassList({ state, setState, open, notify }: W<'state' | 'setState' | 'open' | 'notify'>) {
  const s = useAppStyles();
  const [rows, setRows] = useState<SchoolClass[] | null>(null);
  const [error, setError] = useState('');
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  /**
   * How a dialog elsewhere in the shell says it changed something.
   *
   * `ClassDialog` is rendered by the dialog registry, not by this card, so
   * there is no callback between them - what they share is the snapshot, and
   * the dialog folds the class it created into it. Reading the length rather
   * than the array settles after one refetch: the mirror below writes exactly
   * the server's rows, so the count the dialog predicted becomes the count the
   * server confirmed and the effect stops.
   */
  const cached = state.classes.length;

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const classes = await listClasses();
        if (!alive) return;
        setRows(classes);
        setError('');
        setState(mirrorClasses(classes));
      } catch (cause) {
        if (!alive) return;
        setRows([]);
        setError(
          cause instanceof ApiError ? cause.message : 'The class list could not be loaded.',
        );
      }
    })();
    return () => {
      alive = false;
    };
  }, [setState, reload, cached]);

  const remove = async (entry: SchoolClass) => {
    if (busy) return;
    setBusy(true);
    try {
      await deleteClass(entry.id);
      setAsking(null);
      notify(`${entry.label} deleted.`);
      setReload((n) => n + 1);
    } catch (cause) {
      const message =
        cause instanceof ApiError ? cause.message : 'That class could not be deleted.';
      setError(message);
      notify(message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={s.dashboardTrack}>
      <CardHead eyebrow="Academic structure" title="Classes">
        <LinkButton title="Add" onPress={() => open('class')} />
      </CardHead>

      {error ? <PanelError message={error} /> : null}
      {rows === null && !error ? <PanelStatus message="Loading classes…" /> : null}

      {rows !== null && !rows.length && !error ? (
        <View style={s.listItem}>
          <Text style={s.listItemText}>No classes yet</Text>
          <ListItemAction title="Add class" onPress={() => open('class')} />
        </View>
      ) : null}

      {(rows ?? []).map((entry) => (
        <View key={entry.id} style={s.listItem}>
          <View style={s.listItemBody}>
            <Text style={s.listItemText}>{entry.label}</Text>
            <Text style={s.listItemCaption}>
              {entry.teacher_name || 'No teacher assigned'} · {entry.student_count} student
              {entry.student_count === 1 ? '' : 's'} · {entry.academic_year}
            </Text>
          </View>
          {asking === entry.id ? (
            <View style={s.listItemBody}>
              <ListItemAction
                title={busy ? 'Deleting…' : 'Confirm delete'}
                label={`Confirm deleting ${entry.label}`}
                onPress={() => void remove(entry)}
              />
              <ListItemAction
                title="Cancel"
                label={`Keep ${entry.label}`}
                onPress={() => setAsking(null)}
              />
            </View>
          ) : (
            <ListItemAction
              title="Delete"
              label={`Delete ${entry.label}`}
              onPress={() => {
                setError('');
                setAsking(entry.id);
              }}
            />
          )}
        </View>
      ))}
    </Card>
  );
}

/**
 * The school's real roster, rendered by the same `StudentsView` the teacher
 * sees.
 *
 * Active students only: `DELETE /students/{id}/` marks a child Inactive rather
 * than removing them, because their results and their parents' links point at
 * the id - so Inactive means "off the roster", and listing them here would put
 * children back on a list a school has already taken them off.
 */
function AdminStudents({ state, setState, open }: W<'state' | 'setState' | 'open'>) {
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  /** The same signal `ClassList` uses; the note there explains it. */
  const cached = state.students.length;

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const students = await listStudents({ status: 'Active' });
        if (!alive) return;
        setError('');
        setLoaded(true);
        setState(mirrorStudents(students));
      } catch (cause) {
        if (!alive) return;
        setLoaded(true);
        setError(cause instanceof ApiError ? cause.message : 'The roster could not be loaded.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [setState, cached]);

  return (
    <>
      {error ? <PanelError message={error} /> : null}
      {!loaded && !error ? <PanelStatus message="Loading the roster…" /> : null}
      <StudentsView state={state} open={open} />
    </>
  );
}

// ---------------------------------------------------------------------------
// School administrator
// ---------------------------------------------------------------------------

/** title, caption, dialog - typed so a misspelt dialog fails to compile. */
const OVERVIEW_ACTIONS: readonly (readonly [string, string, DialogName])[] = [
  ['Invite user', 'Name, email, role and school', 'invite'],
  ['Add class', 'Class, section and subject', 'class'],
  ['Manage school', 'Profile, board and branding', 'school'],
  ['Privacy & retention', 'Access and data policy', 'privacy-settings'],
];

const BRANDING_ITEMS: readonly (readonly [string, string, DialogName])[] = [
  ['School branding', 'Logo, report cover and co-branding', 'school'],
  ['Privacy & retention', 'Retention, recovery and deletion', 'privacy-settings'],
  ['Login-provider policy', 'Google, Microsoft and email fallback', 'security-settings'],
  ['Notifications', 'Frequency and templates', 'notification-settings'],
  ['Support access', 'Reason, named agent and expiry', 'support-access'],
  ['Report settings', 'Expiry, download and OTP defaults', 'report-settings'],
];

export function SchoolAdminApp({
  module,
  state,
  setState,
  open,
  notify,
}: W<'module' | 'state' | 'setState' | 'open' | 'notify'>) {
  const s = useAppStyles();

  /**
   * Activate or disable one account.
   *
   * The server is asked first and the roster changes only once it agrees: a
   * disabled account that still showed as Active - or the reverse - would be an
   * administrator acting on something that is not true. An Invited user flips
   * to Active, which is what the web did.
   */
  const toggle = async (id: string) => {
    const current = state.users.find((user: User) => user.id === id);
    const status: User['status'] = current?.status === 'Active' ? 'Inactive' : 'Active';
    try {
      const response = await authFetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: id, status }),
      });
      if (!response.ok) {
        notify(await apiMessage(response, 'User status could not be updated'), 'error');
        return;
      }
    } catch {
      // The web let a network failure escape as an unhandled rejection. On a
      // device that is also where an unset API origin surfaces, so it is said
      // out loud rather than dropped.
      notify('User status could not be updated', 'error');
      return;
    }
    setState((prev: DemoState) => ({
      ...prev,
      users: prev.users.map((user) => (user.id === id ? { ...user, status } : user)),
    }));
    notify('User status updated');
  };

  // Billing carries its own heading and its own flow, so it replaces the
  // switchboard's page rather than sitting under a second "Billing" title.
  if (module === 'Billing') return <SchoolBilling notify={notify} />;

  return (
    <>
      <PageHead
        eyebrow="School administrator"
        title={module}
        subtitle="Manage people, school structure and access with a clear audit trail.">
        {module === 'Users' ? (
          <AppButton
            variant="primary"
            icon="＋"
            title="Invite user"
            onPress={() => open('invite')}
          />
        ) : null}
        {module === 'Schools & Classes' ? (
          <AppButton variant="primary" icon="＋" title="Add class" onPress={() => open('class')} />
        ) : null}
      </PageHead>

      {module === 'Overview' ? (
        <>
          <MetricStrip
            items={[
              ['Users', String(state.users.length), 'Across all roles'],
              [
                'Invitations',
                String(state.users.filter((user: User) => user.status === 'Invited').length),
                'Pending',
              ],
              ['Classes', String(state.classes.length), 'Current year'],
              ['Schools', String(state.schools.length), 'Active tenant'],
            ]}
          />
          <View style={s.dashboardGrid}>
            <CardSpan2>
              <CardHead eyebrow="Admin actions" title="School setup" />
              <View style={s.adminActions}>
                {OVERVIEW_ACTIONS.map(([title, caption, dialog]) => (
                  <AdminAction
                    key={title}
                    title={title}
                    caption={caption}
                    onPress={() => open(dialog)}
                  />
                ))}
              </View>
            </CardSpan2>
          </View>
        </>
      ) : null}

      {module === 'Users' ? (
        <Card>
          <CardHead eyebrow="People, access & credit usage" title="Users">
            <AppButton variant="primary" title="Invite Teacher" onPress={() => open('invite')} />
          </CardHead>
          <View style={s.userTable}>
            {state.users.map((user: User) => {
              const total = user.totalCredits || 0;
              const used = user.usedCredits || 0;
              return (
                <View key={user.id} style={s.userRow}>
                  <View style={[s.avatar, s.userRowAvatar]}>
                    <Text style={s.avatarText}>{initialsOf(user.name)}</Text>
                  </View>
                  <View style={s.userRowIdentity}>
                    <Text style={s.userRowName}>{user.name}</Text>
                    <Text style={s.userRowCaption}>
                      {user.email} · {user.school}
                      {'\n'}
                      Credits: Total {total} · Used {used} · Remaining {Math.max(0, total - used)}
                    </Text>
                  </View>
                  <View style={s.userRowCell}>
                    <Text style={s.userRowCaption}>{user.role}</Text>
                  </View>
                  <View style={s.userRowCell}>
                    <StatusPill
                      tone={
                        user.status === 'Active'
                          ? 'success'
                          : user.status === 'Invited'
                            ? 'warning'
                            : undefined
                      }>
                      {user.status}
                    </StatusPill>
                  </View>
                  <View style={s.userRowActions}>
                    <ButtonRow>
                      <LinkButton
                        title="View / Edit"
                        accessibilityLabel={`View or edit ${user.name}`}
                        onPress={() => open(`edit-user:${user.id}`)}
                      />
                      <LinkButton
                        title="Assign Credits"
                        accessibilityLabel={`Assign credits to ${user.name}`}
                        onPress={() => open(`credits-user:${user.id}`)}
                      />
                      <LinkButton
                        title="Resend Invite"
                        accessibilityLabel={`Resend invite to ${user.name}`}
                        onPress={() => open(`reset-user:${user.id}`)}
                      />
                      <LinkButton
                        title={user.status === 'Active' ? 'Disable' : 'Activate'}
                        accessibilityLabel={`${user.status === 'Active' ? 'Disable' : 'Activate'} ${user.name}`}
                        onPress={() => void toggle(user.id)}
                      />
                    </ButtonRow>
                  </View>
                </View>
              );
            })}
          </View>
        </Card>
      ) : null}

      {module === 'Schools & Classes' ? (
        <View style={s.dashboardGrid}>
          <Card style={s.dashboardTrack}>
            <CardHead eyebrow="School profile" title="Schools">
              <LinkButton title="Edit" onPress={() => open('school')} />
            </CardHead>
            {state.schools.map((school: string) => (
              <View key={school} style={s.listItem}>
                <Text style={s.listItemText}>{school}</Text>
                <ListItemAction
                  title="Manage"
                  label={`Manage ${school}`}
                  onPress={() => open('school')}
                />
              </View>
            ))}
          </Card>
          <ClassList state={state} setState={setState} open={open} notify={notify} />
        </View>
      ) : null}

      {module === 'Students' ? (
        <AdminStudents state={state} setState={setState} open={open} />
      ) : null}

      {module === 'Academic years' ? (
        <Card>
          <CardHead eyebrow="School calendar" title="Academic years">
            <AppButton
              variant="primary"
              icon="＋"
              title="Add year"
              onPress={() => open('academic-year')}
            />
          </CardHead>
          {state.academicYears.map((year: string) => (
            <View key={year} style={s.listItem}>
              <Text style={s.listItemText}>{year}</Text>
              {/* `.list-item div` stacked the web's `.button-row` into a column. */}
              <View style={s.listItemBody}>
                <ListItemAction
                  title="Edit"
                  label={`Edit ${year}`}
                  onPress={() => open('academic-year')}
                />
                <ListItemAction
                  title="Change status"
                  label={`Change status of ${year}`}
                  onPress={() => notify('Academic year status updated')}
                />
              </View>
            </View>
          ))}
        </Card>
      ) : null}

      {module === 'Branding & Privacy' ? (
        <View style={s.settingsGrid}>
          {BRANDING_ITEMS.map(([title, caption, dialog]) => (
            <Pressable
              key={title}
              role="button"
              accessibilityLabel={`${title}. ${caption}`}
              onPress={() => open(dialog)}
              style={({ hovered, pressed }) => [
                s.settingsCard,
                s.settingsTrack,
                (hovered || pressed) && s.settingsCardHover,
              ]}>
              <Text style={s.settingsCardTitle}>{title}</Text>
              <Text style={s.settingsCardCaption}>{caption}</Text>
              <Text style={s.settingsCardAction}>Manage →</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {module === 'Reports' ? <Reports state={state} open={open} notify={notify} /> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Principal
// ---------------------------------------------------------------------------

export function PrincipalApp({
  module,
  state,
  open,
  notify,
}: W<'module' | 'state' | 'open' | 'notify'>) {
  if (module === 'Reports') return <Reports state={state} open={open} notify={notify} />;
  return <PrincipalOverview state={state} open={open} notify={notify} />;
}

/**
 * Aggregated, non-punitive: cohort figures and the lowest-mastery concept, never
 * a named teacher or student. With nothing graded it says so instead of
 * charting a zero.
 */
function PrincipalOverview({ state, open, notify }: W<'state' | 'open' | 'notify'>) {
  const s = useAppStyles();
  const concepts = useMemo(() => conceptMastery(state), [state]);
  const mastery = useMemo(() => overallMastery(state), [state]);
  const trend = useMemo(() => masteryTrend(state), [state]);

  const priorityGaps = concepts.filter((c) => c.mastery < 70).length;
  const completed = state.interventions.filter(
    (i: Intervention) => i.status === 'Completed',
  ).length;
  const interventionRate = state.interventions.length
    ? Math.round((completed / state.interventions.length) * 100)
    : 0;
  const lowest = concepts[0];

  return (
    <>
      <PageHead
        eyebrow="Principal workspace"
        title="School academic improvement"
        subtitle="Aggregated, non-punitive insight for planning academic support.">
        <AppButton
          variant="primary"
          title="Generate leadership report"
          onPress={() => open('report')}
        />
      </PageHead>

      <MetricStrip
        items={[
          ['Students in roster', String(state.students.length), 'Assigned classes'],
          [
            'Priority gaps',
            String(priorityGaps),
            `Across ${concepts.length} concept${concepts.length === 1 ? '' : 's'}`,
          ],
          [
            'Interventions complete',
            `${interventionRate}%`,
            `${completed} of ${state.interventions.length}`,
          ],
          ['Overall mastery', mastery === null ? 'No data' : `${mastery}%`, 'Graded evidence'],
        ]}
      />

      <SchoolPerformanceMatrix state={state} />

      <View style={s.dashboardGrid}>
        <CardSpan2>
          <CardHead eyebrow="School trend" title="Mastery from graded evidence" />
          {trend.length ? (
            <View style={s.chart} accessibilityLabel="School mastery trend chart">
              {trend.map((t) => (
                <Pressable
                  key={t.label}
                  role="button"
                  accessibilityLabel={`${t.label}, ${t.value}% mastery evidence`}
                  onPress={() => notify(`${t.label}: ${t.value}% mastery evidence`)}
                  style={[s.chartBar, { height: `${Math.max(0, Math.min(100, t.value))}%` }]}
                />
              ))}
            </View>
          ) : (
            <Text style={s.modalCopy}>No graded evidence yet across more than one date.</Text>
          )}
        </CardSpan2>

        <Card style={s.dashboardTrack}>
          <Text style={s.eyebrow}>Management action</Text>
          <Text accessibilityRole="header" style={s.cardTitle}>
            Protect remedial time
          </Text>
          <Text style={s.cardBody}>
            {lowest
              ? `${lowest.concept} is currently the lowest-mastery concept with graded evidence (${lowest.mastery}%).`
              : 'No graded evidence yet to identify a priority concept.'}
          </Text>
          {/* In a row so the button keeps its own width, as the inline web button did. */}
          <ButtonRow>
            <AppButton
              variant="primary"
              title="Assign action"
              onPress={() => notify('Action assigned to academic head')}
            />
          </ButtonRow>
        </Card>
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// Platform operator
// ---------------------------------------------------------------------------

const OVERVIEW_CONTROLS = [
  'Tenant management',
  'Usage analytics',
  'AI providers',
  'Model routing',
  'Prompt versions',
  'Academic configuration',
  'Feature flags',
  'Gamification',
  'Notifications',
  'Privacy',
  'System health',
  'Audit logs',
] as const;

/**
 * The control cards each module lists. Keyed by string because `module` is
 * the shell's whole module union; an unlisted module shows the overview's, as
 * on the web. System health and Schools are listed but never reach this grid -
 * they render their ported panels instead.
 */
const MODULE_CONTROLS: Record<string, readonly string[]> = {
  Overview: OVERVIEW_CONTROLS,
  Schools: [
    'Search schools',
    'Plans & limits',
    'Suspend / reactivate',
    'Pilot status',
    'Support owner',
    'Internal notes',
  ],
  Users: [
    'Search users',
    'Suspend access',
    'Reset access',
    'Login history',
    'Terms version',
    'Platform roles',
  ],
  Analytics: [
    'DAU / WAU / MAU',
    'Assessments & pages',
    'AI acceptance & changes',
    'Regrading',
    'X-Rays & interventions',
    'Time saved & AI cost',
  ],
  'AI Configuration': [
    'Provider registry',
    'Model registry',
    'Routing rules',
    'Prompt versions',
    'Output schemas',
    'Fallback sequence',
  ],
  'Feature flags': [
    'AI grading',
    'Handwriting recognition',
    'Regrading',
    'Gamification',
    'Principal reporting',
    'Experimental models',
  ],
  'System health': [
    'API uptime',
    'Queue depth',
    'Provider latency',
    'Database & storage',
    'Failed jobs',
    'Active incidents',
  ],
  Audit: [
    'Authentication',
    'Configuration changes',
    'Support access',
    'Tenant changes',
    'AI versions',
    'Retention actions',
  ],
};

const SAFEGUARDS = [
  'Tenant isolation',
  'Identifiable-data restriction',
  'Prompt versioning',
  'Support-access expiry',
  'Audit logging',
];

export function PlatformApp({
  module,
  state,
  open,
  notify,
}: W<'module' | 'state' | 'open' | 'notify'>) {
  const s = useAppStyles();
  const controls = MODULE_CONTROLS[module] ?? OVERVIEW_CONTROLS;

  const totalFiles = state.assessments.reduce(
    (sum: number, a: Assessment) => sum + (a.files?.length || 0),
    0,
  );
  const results = useMemo(() => allGradeResults(state), [state]);
  const reviewRatio = state.assessments.length
    ? Math.round(
        (state.assessments.reduce(
          (sum: number, a: Assessment) => sum + (a.totalReviews ? a.reviewed / a.totalReviews : 0),
          0,
        ) /
          state.assessments.length) *
          100,
      )
    : null;

  let panel: ReactNode;
  if (module === 'System health') panel = <SystemHealthPanel state={state} />;
  else if (module === 'Schools') panel = <SchoolDirectory notify={notify} />;
  else
    panel = (
      <CardSpan2>
        <CardHead eyebrow={module} title="Controls & evidence" />
        <View style={s.adminActions}>
          {controls.map((control) => (
            <AdminAction
              key={control}
              title={control}
              caption="View, configure and audit"
              onPress={() => open('platform-config')}
            />
          ))}
        </View>
      </CardSpan2>
    );

  return (
    <>
      <PageHead
        eyebrow="EduAI Hub platform administrator"
        title={module === 'Overview' ? 'Platform operations' : module}
        subtitle="Tenant health, responsible AI operations and auditable configuration.">
        <AppButton
          variant="primary"
          icon="＋"
          title="Configure"
          onPress={() => open('platform-config')}
        />
      </PageHead>

      <MetricStrip
        items={[
          ['Active schools', String(state.schools.length), 'This tenant'],
          ['Files processed', String(totalFiles), 'Uploaded to assessments'],
          ['Graded evidence', String(results.length), 'EduAI analysis'],
          [
            'Teacher review rate',
            reviewRatio === null ? 'No data' : `${reviewRatio}%`,
            'Avg across assessments',
          ],
        ]}
      />

      <View style={s.dashboardGrid}>
        {panel}
        <Card style={s.dashboardTrack}>
          <Text style={s.eyebrow}>Responsible operations</Text>
          <Text accessibilityRole="header" style={s.cardTitle}>
            Current safeguards
          </Text>
          {SAFEGUARDS.map((item) => (
            <View key={item} style={s.listItem}>
              <Text style={s.listItemText}>{item}</Text>
              <StatusPill tone="success">Active</StatusPill>
            </View>
          ))}
        </Card>
      </View>
    </>
  );
}
