/**
 * /parent - the parent landing page.
 *
 * Ported from frontend/app/parent/page.tsx.
 *
 * The destination the role-aware redirect needs, and the first screen to read
 * the normalized read model rather than a teacher's workspace snapshot. It
 * shows only teacher-approved output: `parent_child_reports()` is built field
 * by field in the database, so OCR transcripts, AI rationale and other
 * people's children are structurally absent rather than filtered here.
 *
 * The web built its own Supabase client and then read /api/profile by hand to
 * recover from a 403. `useSession` already owns both, so this screen takes the
 * session and the profile from there and keeps `landingPath` as the one place
 * that decides where a role belongs.
 *
 * The data comes from Django (`GET /parents/reports`, plan row 13.3), not from
 * the Expo server route this screen was ported against. That route read the
 * same SQL function with the service-role key, which is to say it produced the
 * right answer with none of what makes an answer trustworthy - no capability
 * check, no throttle, no audit row. It has been deleted rather than kept as a
 * fallback.
 *
 * Two additions on top of the port (plan row 12.2):
 *
 *  * **Linking a child lives here too.** A parent adds their second child a
 *    term after their first, so the invite-code form is not only a step in
 *    signing up. It is the same `LinkChildForm` /parent/join uses - one form,
 *    because there is one endpoint behind it.
 *  * **A signed-in visitor with no profile row goes to /parent/join** rather
 *    than to `landingPath(null)`, which is /app. Someone who arrived here
 *    holding no role came looking for the parent portal; sending them to the
 *    teaching workspace to complete a profile they cannot complete - a parent
 *    has no school to register - is a dead end.
 */

import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';

import { useSession } from '@/features/auth/hooks/use-session';
import { landingPath } from '@/features/auth/roles';
import {
  ApiError,
  childReports,
  unlinkChild,
  type ChildReport,
} from '@/features/parents/api/parentsApi';
import { LinkChildForm } from '@/features/parents/components/link-child-form';
import { AppLoading, BrandLogo } from '@/shared/components/brand';
import { AppButton, ButtonRow } from '@/shared/components/buttons';
import { ConfirmDialog, ModalShell } from '@/shared/components/modal';
import { Eyebrow } from '@/shared/components/primitives';
import { useAppStyles } from '@/shared/theme/styles';

/* The payload shape lives in the feature slice beside the call that returns
   it, so a field added to the read model is described in one place rather than
   in every screen that happens to read it. */

export default function ParentRoute() {
  const s = useAppStyles();
  const router = useRouter();
  const { session, profile, needsProfile, loading } = useSession();

  const [children, setChildren] = useState<ChildReport[] | null>(null);
  const [error, setError] = useState('');
  /** Bumped after a code is redeemed, to re-read the list the link changed. */
  const [reload, setReload] = useState(0);
  /** The child whose removal is awaiting confirmation. */
  const [removing, setRemoving] = useState<ChildReport | null>(null);
  const [removeError, setRemoveError] = useState('');

  useEffect(() => {
    if (loading) return;
    if (!session) {
      router.replace('/signin?next=/parent' as Href);
      return;
    }
    // Signed in, no profile row: they hold no role yet. See the note at the top
    // of the file for why that lands here rather than at `landingPath(null)`.
    if (needsProfile) {
      router.replace('/parent/join' as Href);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const { children: reports } = await childReports();
        if (alive) setChildren(reports ?? []);
      } catch (cause) {
        // Signed in, but not a parent: Django answers 403 because the caller
        // holds no `parent.child.reports.read`. Send them to their own landing
        // rather than showing an error for a page that was never theirs.
        if (cause instanceof ApiError && cause.status === 403) {
          router.replace(landingPath(profile) as Href);
          return;
        }
        if (alive)
          setError(
            cause instanceof ApiError
              ? cause.message
              : "Your children's reports could not be loaded.",
          );
      }
    })();
    return () => {
      alive = false;
    };
  }, [session, profile, needsProfile, loading, router, reload]);

  if (error)
    return (
      <ScrollView contentContainerStyle={s.parentDashboard}>
        <View style={[s.parentDashboardInner, s.parentCard]}>
          <Text accessibilityRole="header" style={s.parentHeroTitle}>
            Reports unavailable
          </Text>
          <Text style={s.parentCardText}>{error}</Text>
        </View>
      </ScrollView>
    );

  if (!children) return <AppLoading message="Loading your children's reports…" />;

  const remove = async (child: ChildReport) => {
    setRemoving(null);
    setRemoveError('');
    try {
      await unlinkChild(child.studentId);
      setReload((n) => n + 1);
    } catch (cause) {
      setRemoveError(
        cause instanceof ApiError
          ? cause.message
          : `${child.studentName} could not be removed right now. Please try again.`,
      );
    }
  };

  const linked = children.length
    ? `${children.length} linked child${children.length === 1 ? '' : 'ren'}`
    : 'No children linked yet';

  return (
    <ScrollView contentContainerStyle={s.parentDashboard}>
      <View style={s.parentDashboardInner}>
        <View style={s.parentHero}>
          <BrandLogo style={s.parentHeroLogo} />
          <Text style={s.parentHeroEyebrow}>Parent dashboard</Text>
          <Text accessibilityRole="header" style={s.parentHeroTitle}>
            {linked}
          </Text>
          <Text style={s.parentSummaryLabel}>Teacher-approved reports only</Text>
        </View>

        {/* The empty state and the "add another child" card are the same card,
            because the action is the same one. Only the copy above it changes:
            a parent with no children needs to be told what a code is, and one
            with two does not. */}
        <View style={s.parentCard}>
          <Eyebrow>{children.length ? 'Another child' : 'Get started'}</Eyebrow>
          <Text accessibilityRole="header" style={s.parentHeroTitle}>
            {children.length ? 'Link another child' : 'Nothing here yet'}
          </Text>
          <Text style={s.parentCardText}>
            {children.length
              ? 'Each child has their own invite code. Enter the next one to see their reports here too.'
              : "Ask your child's teacher for an invite code. Once it is redeemed, their teacher-approved learning reports appear here automatically."}
          </Text>
          <LinkChildForm onLinked={() => setReload((n) => n + 1)} />
        </View>

        {children.map((child) => (
          <View key={child.studentId} style={s.parentCard}>
            <View style={s.parentGapHeader}>
              <Text accessibilityRole="header" style={s.parentSummaryValue}>
                {child.studentName}
              </Text>
              <Text style={s.parentSummaryLabel}>
                {child.className}
                {child.rollNumber ? ` · ${child.rollNumber}` : ''} · {child.schoolName}
              </Text>
            </View>

            {!child.results.length ? (
              <Text style={s.parentCardText}>
                No published assessments yet for {child.studentName}.
              </Text>
            ) : null}

            {child.results.map((result) => {
              const percentage = Math.round(
                (Number(result.score) / Math.max(1, Number(result.maxMarks))) * 100,
              );
              return (
                <View key={`${child.studentId}-${result.assessmentId}`} style={s.parentGap}>
                  <View style={s.parentGapHeader}>
                    <Text style={s.parentSummaryValue}>{result.title}</Text>
                    <Text style={s.parentSummaryLabel}>
                      {result.score}/{result.maxMarks} · {percentage}%
                    </Text>
                  </View>
                  <Text style={s.parentSummaryLabel}>
                    {result.subject} · {result.date}
                  </Text>
                  {result.feedback ? (
                    <Text style={s.parentCardText}>{result.feedback}</Text>
                  ) : null}
                  {result.gaps?.map((gap) => (
                    <Text key={gap.concept} style={s.parentCardText}>
                      {gap.concept} — {gap.mastery}% mastery
                    </Text>
                  ))}
                </View>
              );
            })}

            {child.resources.length ? (
              <>
                <Text accessibilityRole="header" style={s.parentSummaryValue}>
                  Learning materials
                </Text>
                {child.resources.map((resource) => (
                  <Text key={resource.id} style={s.parentCardText}>
                    {resource.title} <Text style={s.parentSummaryLabel}>({resource.type})</Text>
                  </Text>
                ))}
              </>
            ) : null}

            {/* The heading says "the class", and that is not padding. An
                intervention hangs off an assessment, never off a student, so
                two siblings in one class see the same list. Titled anything
                more personal, a parent would read a plan written for thirty
                children as a note about theirs. */}
            {child.classInterventions.length ? (
              <>
                <Text accessibilityRole="header" style={s.parentSummaryValue}>
                  What the class is working on next
                </Text>
                {child.classInterventions.map((plan) => (
                  <View key={plan.id} style={s.parentGap}>
                    <View style={s.parentGapHeader}>
                      <Text style={s.parentSummaryValue}>{plan.concept}</Text>
                      <Text style={s.parentSummaryLabel}>{plan.status}</Text>
                    </View>
                    <Text style={s.parentSummaryLabel}>
                      {[plan.format, plan.duration].filter(Boolean).join(' · ')}
                      {plan.followupDate ? ` · follow-up ${plan.followupDate}` : ''}
                    </Text>
                    <Text style={s.parentCardText}>
                      Planned after {plan.title} ({plan.subject}).
                    </Text>
                  </View>
                ))}
                <Text style={s.parentSummaryLabel}>
                  These are the teacher&apos;s plans for the whole class, not a report on your
                  child.
                </Text>
              </>
            ) : null}

            {/* Ends this account's own access, nobody else's - the only unlink a
                parent holds. Behind a confirmation because undoing it needs a new
                code from the school, not a second tap. */}
            <ButtonRow>
              <AppButton
                variant="link"
                title="Remove from my account"
                onPress={() => {
                  setRemoveError('');
                  setRemoving(child);
                }}
              />
            </ButtonRow>
          </View>
        ))}

        {removeError ? (
          <View role="alert" style={s.parentCard}>
            <Text style={s.parentCardText}>{removeError}</Text>
          </View>
        ) : null}

        <View style={s.parentCard}>
          <Text style={s.parentSummaryLabel}>
            These reports are prepared and approved by your child&apos;s teacher. They do not show
            other students, and they are not used for ranking.
          </Text>
        </View>
      </View>

      {removing ? (
        <ModalShell label="Remove child" onClose={() => setRemoving(null)}>
          <ConfirmDialog
            eyebrow="Parent account"
            title={`Remove ${removing.studentName} from your account?`}
            text={`You will stop seeing ${removing.studentName}'s reports straight away. Nothing is deleted from the school's records. To see them again you will need a new invite code from ${removing.schoolName} - the old one will not work.`}
            action="Remove"
            onConfirm={() => void remove(removing)}
          />
        </ModalShell>
      ) : null}
    </ScrollView>
  );
}
