/**
 * The signed-in workspace: the chrome, the workspace state, and whichever
 * module is on screen.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx `WorkspaceApp` (~301) and
 * `TeacherApp` (~427).
 *
 * The web shell held everything inline - the restore-and-sync effects, the
 * credits fetch, the admin user list, the sidebar markup. Those were ported
 * ahead of it as `useWorkspaceSync`, `useCredits`, `useAdminUsers` and the
 * `Sidebar`/`Topbar`/`MobileNav` views, so what is left here is assembly: the
 * state only the shell can own (the current module, the selected assessment,
 * the open dialog, the toast) and the switch that picks a page for the role.
 *
 * Three departures, each because the web version was wrong or impossible here:
 *
 *  * **Review with no assessment is an empty state, not a crash.** A brand-new
 *    teacher's workspace has no assessments, so `selected` is undefined, and
 *    the web's `Review` read `selected.gradeResults` on its first line. Work and
 *    X-Ray already guard with `selected?.`; Review is the one page that cannot
 *    render anything without an assessment, so the shell does not ask it to.
 *  * **A Parent never reaches this screen.** The web rendered `ParentPending`,
 *    a "coming soon" card, because there was no parent portal. There is now -
 *    /parent - and the route redirects there before this mounts. The branch
 *    below remains only so an unexpected role cannot fall through to the
 *    platform console.
 *  * **"Reload" after a sync conflict remounts instead of reloading the page.**
 *    `location.reload()` does not exist on a device. The route keys this screen,
 *    so `onReload` gives it a fresh mount, which re-runs the restore and picks
 *    up the other device's revision - the same outcome as the web.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTE
 * ---------------------------------------------------------------------------
 * The appearance toggle goes through `useThemePreference`, which persists the
 * choice and publishes it to `@/shared/hooks/scheme-override`. Every style
 * resolves its scheme through that, so the toggle restyles the whole app on
 * web and native alike. The web wrote `data-theme` onto <html>; React Native
 * has no root element to write to.
 *
 * `.app-shell` is a CSS grid; here the sidebar is absolutely positioned and
 * `main` carries the matching left margin, as styles.ts already encodes. The
 * scrolling region is the content only, so the top bar stays put - the web got
 * that from `position: sticky`.
 */

import { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  PlatformApp,
  PrincipalApp,
  SchoolAdminApp,
} from '@/features/admin/components/admin-apps';
import { Review } from '@/features/grading/components/review';
import { AchievementsView } from '@/features/teacher/components/achievements';
import { TeacherHome } from '@/features/teacher/components/home';
import { Interventions } from '@/features/teacher/components/interventions';
import { Reports } from '@/features/teacher/components/reports';
import { ResourcesView } from '@/features/teacher/components/resources';
import { SettingsView } from '@/features/teacher/components/settings';
import { StudentsView } from '@/features/teacher/components/students';
import { Work } from '@/features/teacher/components/work';
import { XRay } from '@/features/teacher/components/xray';
import { AppDialog } from '@/features/workspace/components/dialog-registry';
import {
  MobileNav,
  navFor,
  Sidebar,
  Topbar,
  type NavModule,
} from '@/features/workspace/components/sidebar';
import { useAdminUsers, useCredits } from '@/features/workspace/hooks/use-account';
import { useWorkspaceSync } from '@/features/workspace/hooks/use-workspace-sync';
import { cloneInitial, stageLabel } from '@/features/workspace/lib/demo-state';
import { AppLoading } from '@/shared/components/brand';
import { AppButton } from '@/shared/components/buttons';
import { PageScrollProvider } from '@/shared/components/page-scroll';
import { PageHead } from '@/shared/components/primitives';
import { Toast } from '@/shared/components/status';
import { useResetOnChange } from '@/shared/hooks/use-reset-on-change';
import { useThemePreference } from '@/shared/hooks/use-theme-preference';
import { useAppStyles } from '@/shared/theme/styles';
import type {
  AdminModule,
  Assessment,
  DemoProfile,
  DemoState,
  Role,
  TeacherModule,
} from '@/shared/types/workspace';
import type {
  DialogType,
  Notify,
  OpenAssessment,
  SetWorkspace,
  ToastKind,
  UpdateAssessment,
} from '@/shared/types/workspace-props';

/** How long a toast stays up - unchanged from the web's 3200ms. */
const TOAST_MS = 3200;

/** The web kept the newest twenty workspace events and dropped the rest. */
const EVENT_LIMIT = 20;

function isTeacher(role: Role): boolean {
  return role === 'Teacher';
}

function isSchoolAdmin(role: Role): boolean {
  return role === 'SchoolAdmin' || role === 'School admin';
}

/** Where a role starts, and where the brand button returns it. */
function homeModule(role: Role): NavModule {
  return isTeacher(role) ? 'Home' : 'Overview';
}

export type WorkspaceScreenProps = {
  profile: DemoProfile;
  onSignOut: () => void;
  /** Recover from a sync conflict by remounting; see the note at the top. */
  onReload: () => void;
};

export function WorkspaceScreen({ profile, onSignOut, onReload }: WorkspaceScreenProps) {
  const s = useAppStyles();
  const insets = useSafeAreaInsets();
  const role = profile.role;

  const { state, setState, ready, syncStatus, freshWorkspace } = useWorkspaceSync(profile);
  const credits = useCredits(role);
  useAdminUsers(role, profile.school, setState);
  const { theme, setChoice } = useThemePreference();

  const [module, setModule] = useState<NavModule>(homeModule(role));
  const [selectedId, setSelectedId] = useState('a1');
  const [dialog, setDialog] = useState<DialogType | null>(null);
  const [toast, setToast] = useState<{ text: string; kind: ToastKind } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The shell's scrolling region, published through `PageScrollProvider`. */
  const scrollRef = useRef<ScrollView>(null);

  // The web's `useResetOnChange(role, ...)`: a role change lands on that role's
  // first module rather than on a module the new role may not have.
  useResetOnChange(role, () => setModule(homeModule(role)));
  // A freshly seeded workspace has no `a1` sample to select.
  useResetOnChange(freshWorkspace, () => {
    if (freshWorkspace) setSelectedId('');
  });

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  if (!ready) return <AppLoading message="Preparing your workspace…" />;

  const nav = navFor(role);
  const selected: Assessment | undefined =
    state.assessments.find((a) => a.id === selectedId) ?? state.assessments[0];

  const notify: Notify = (text, kind = 'success') => {
    // One timer at a time. The web let an older timer clear a newer toast, so a
    // second message raised within 3.2s of the first vanished early.
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, kind });
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  };

  const update: UpdateAssessment = (id, patch) =>
    setState((current: DemoState) => ({
      ...current,
      assessments: current.assessments.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      events: [
        `${new Date().toLocaleTimeString()} · ${patch.stage ? stageLabel[patch.stage] : 'Assessment updated'}`,
        ...current.events,
      ].slice(0, EVENT_LIMIT),
    }));

  const openAssessment: OpenAssessment = (id, next = 'Work') => {
    setSelectedId(id);
    setModule(next);
  };

  const resetDemo = () => {
    setState(cloneInitial());
    setSelectedId('a1');
    notify('Demo data restored');
  };

  const reviewCount = state.assessments.reduce(
    (n, a) => n + Math.max(0, a.totalReviews - a.reviewed),
    0,
  );

  return (
    <View style={[s.appShell, s.functionalShell, { paddingTop: insets.top }]}>
      <Sidebar
        profile={profile}
        module={module}
        nav={nav}
        onModule={setModule}
        onBrand={() => setModule(homeModule(role))}
        reviewCount={reviewCount}
        onActivity={() => setDialog('activity')}
        onProfile={() => setDialog('profile')}
      />

      <View style={s.main}>
        <Topbar
          profile={profile}
          role={role}
          syncStatus={syncStatus}
          onReload={onReload}
          credits={credits}
          notifications={state.events.length}
          onNotifications={() => setDialog('notifications')}
          onSignOut={onSignOut}
          dark={theme === 'dark'}
          onToggleTheme={() => setChoice(theme === 'dark' ? 'light' : 'dark')}
        />
        {/* The shell owns the vertical scroll, so a module that needs to bring
            one of its own rows into view (the review navigator's jump to
            question) has to be handed it. */}
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled">
          <PageScrollProvider scrollRef={scrollRef}>
            <ModuleView
              role={role}
              profile={profile}
              module={module}
              state={state}
              setState={setState}
              selected={selected}
              openAssessment={openAssessment}
              open={setDialog}
              notify={notify}
              update={update}
            />
          </PageScrollProvider>
        </ScrollView>
      </View>

      <MobileNav
        module={module}
        nav={nav}
        onModule={setModule}
        bottomInset={insets.bottom}
      />

      {toast ? <Toast text={toast.text} kind={toast.kind} /> : null}

      {dialog ? (
        <AppDialog
          type={dialog}
          close={() => setDialog(null)}
          open={setDialog}
          state={state}
          setState={setState}
          // Undefined for a brand-new teacher, exactly as the web passed it. The
          // registry guards the dialogs that read it (`NEEDS_ASSESSMENT`); the
          // ones a new teacher opens first - create-assessment, profile,
          // activity - do not, and gating the whole registry on an assessment
          // existing would lock them out of creating their first one.
          selected={selected as Assessment}
          update={update}
          notify={notify}
          resetDemo={resetDemo}
          openAssessment={openAssessment}
        />
      ) : null}
    </View>
  );
}

type ModuleViewProps = {
  role: Role;
  profile: DemoProfile;
  module: NavModule;
  state: DemoState;
  setState: SetWorkspace;
  selected: Assessment | undefined;
  openAssessment: OpenAssessment;
  open: (type: DialogType) => void;
  notify: Notify;
  update: UpdateAssessment;
};

/** The page for this role and module. The web's inline role ternary plus `TeacherApp`. */
function ModuleView(props: ModuleViewProps) {
  const { role, module, state, setState, open, notify } = props;

  if (isTeacher(role))
    return <TeacherModuleView {...props} module={module as TeacherModule} />;
  if (isSchoolAdmin(role))
    return (
      <SchoolAdminApp
        module={module as AdminModule}
        state={state}
        setState={setState}
        open={open}
        notify={notify}
      />
    );
  if (role === 'Principal')
    return (
      <PrincipalApp
        module={module as AdminModule}
        state={state}
        open={open}
        notify={notify}
      />
    );
  if (role === 'SuperAdmin' || role === 'Platform admin')
    return (
      <PlatformApp
        module={module as AdminModule}
        state={state}
        open={open}
        notify={notify}
      />
    );

  // A Parent is redirected to /parent before this screen mounts. Anything that
  // still lands here holds a role this workspace has no page for, and gets
  // nothing rather than the platform console the web would have fallen into.
  return (
    <PageHead
      eyebrow={`${role} account`}
      title="This workspace is not for your account"
      subtitle="Your role does not have a workspace here. Sign out and sign in with the account your school gave you."
    />
  );
}

/** `TeacherApp` from the web, with the Review guard described at the top. */
function TeacherModuleView({
  profile,
  module,
  state,
  setState,
  selected,
  openAssessment,
  open,
  notify,
  update,
}: ModuleViewProps & { module: TeacherModule }) {
  if (module === 'Home')
    return (
      <TeacherHome
        profile={profile}
        state={state}
        openAssessment={openAssessment}
        open={open}
      />
    );
  if (module === 'Work')
    return (
      <Work
        state={state}
        // Work guards every read with `selected?.`, as the web did.
        selected={selected as Assessment}
        openAssessment={openAssessment}
        open={open}
        update={update}
        notify={notify}
      />
    );
  if (module === 'Review') {
    if (!selected)
      return (
        <PageHead
          eyebrow="Review"
          title="Nothing to review yet"
          subtitle="Create an assessment and upload answer sheets. AI-suggested marks appear here as drafts until you approve them.">
          <AppButton
            variant="primary"
            title="Create assessment"
            onPress={() => open('create-assessment')}
          />
        </PageHead>
      );
    return (
      <Review
        selected={selected}
        update={update}
        notify={notify}
        open={open}
        setState={setState}
      />
    );
  }
  if (module === 'X-Ray')
    // X-Ray reads the class and subject through `selected?.`, as the web did.
    return (
      <XRay state={state} selected={selected as Assessment} open={open} notify={notify} />
    );
  if (module === 'Interventions')
    return <Interventions state={state} setState={setState} open={open} notify={notify} />;
  if (module === 'Students') return <StudentsView state={state} open={open} />;
  if (module === 'Resources')
    return <ResourcesView state={state} setState={setState} open={open} notify={notify} />;
  if (module === 'Achievements') return <AchievementsView state={state} notify={notify} />;
  if (module === 'Settings') return <SettingsView open={open} />;
  return <Reports state={state} open={open} notify={notify} />;
}
