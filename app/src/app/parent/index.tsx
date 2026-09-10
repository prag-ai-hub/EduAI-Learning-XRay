/**
 * /parent - the parent landing page.
 *
 * Ported from frontend/app/parent/page.tsx.
 *
 * The destination the role-aware redirect needs, and the first screen to read
 * the normalized read model rather than a teacher's workspace snapshot. It
 * shows only teacher-approved output: /api/parent/children is built field by
 * field in the database, so OCR transcripts, AI rationale and other people's
 * children are structurally absent rather than filtered here.
 *
 * The web built its own Supabase client and then read /api/profile by hand to
 * recover from a 403. `useSession` already owns both, so this screen takes the
 * session and the profile from there and keeps `landingPath` as the one place
 * that decides where a role belongs.
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

import { authFetch } from '@/features/auth/api/authApi';
import { useSession } from '@/features/auth/hooks/use-session';
import { landingPath } from '@/features/auth/roles';
import { LinkChildForm } from '@/features/parents/components/link-child-form';
import { AppLoading, BrandLogo } from '@/shared/components/brand';
import { Eyebrow } from '@/shared/components/primitives';
import { useAppStyles } from '@/shared/theme/styles';

/** One published assessment result, as `/api/parent/children` returns it. */
type ChildResult = {
  assessmentId: string;
  title: string;
  subject: string;
  date: string;
  score: number;
  maxMarks: number;
  feedback: string | null;
  gaps: { concept: string; mastery: number }[];
};

type Child = {
  studentId: string;
  studentName: string;
  rollNumber: string | null;
  className: string;
  schoolName: string;
  results: ChildResult[];
  resources: { id: string; title: string; type: string }[];
};

export default function ParentRoute() {
  const s = useAppStyles();
  const router = useRouter();
  const { session, profile, needsProfile, loading } = useSession();

  const [children, setChildren] = useState<Child[] | null>(null);
  const [error, setError] = useState('');
  /** Bumped after a code is redeemed, to re-read the list the link changed. */
  const [reload, setReload] = useState(0);

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
        const response = await authFetch('/api/parent/children', { cache: 'no-store' });
        if (response.status === 403) {
          // Signed in, but not a parent. Send them to their own landing rather
          // than showing an error for a page that was never theirs.
          router.replace(landingPath(profile) as Href);
          return;
        }
        const payload = await response.json();
        if (!response.ok)
          throw new Error(payload.error || "Your children's reports could not be loaded.");
        if (alive) setChildren(payload.children || []);
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : 'Something went wrong.');
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
          </View>
        ))}

        <View style={s.parentCard}>
          <Text style={s.parentSummaryLabel}>
            These reports are prepared and approved by your child&apos;s teacher. They do not show
            other students, and they are not used for ranking.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}
