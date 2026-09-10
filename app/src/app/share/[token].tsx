/**
 * /share/[token] - the public student dashboard behind a signed link.
 *
 * Ported from frontend/app/share/[token]/page.tsx.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTES
 * ---------------------------------------------------------------------------
 * 1. The route parameter. Next.js handed the page a `params` promise; Expo
 *    Router hands it `useLocalSearchParams`, which is already resolved.
 *
 * 2. The request is deliberately `apiFetch`, not `authFetch`: the token in the
 *    URL is the whole authorisation, and this page is opened by parents who
 *    have no account at all.
 *
 * 3. `window.print()` has no counterpart on a device - React Native has no
 *    print service and `expo-print` is not a dependency - so the print button
 *    is rendered on web only. On a phone the page is the report; nothing is
 *    hidden behind the button that is not already on screen.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { apiFetch } from '@/features/auth/api/authApi';
import { BrandLogo } from '@/shared/components/brand';
import { useAppStyles } from '@/shared/theme/styles';

/**
 * The payload `get_shared_student_report` builds in Postgres, passed straight
 * through by the /api/shares/[token] route. Optional fields are the ones a
 * resource may legitimately omit for its type - a study guide has `guide`, a
 * worksheet has `content`.
 */
export type SharedGap = { concept: string; mastery: number; finding?: string; rework?: string };
export type SharedTopic = { concept: string; explanation?: string; workedExample?: string };
export type SharedQuestion = { question: string };
export type SharedResource = {
  id: string;
  type: string;
  title: string;
  guide?: { topics?: SharedTopic[] };
  content?: { mcqQuestions?: SharedQuestion[]; subjectiveQuestions?: SharedQuestion[] };
};
export type SharedReport = {
  student: { name: string; className?: string };
  assessment: {
    title: string;
    subject: string;
    score: number;
    maxMarks: number;
    feedback?: string;
    gaps?: SharedGap[];
  };
  resources: SharedResource[];
};

export default function StudentShareRoute() {
  const s = useAppStyles();
  const { token } = useLocalSearchParams<{ token: string }>();
  const [data, setData] = useState<SharedReport | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    let alive = true;
    void (async () => {
      try {
        const response = await apiFetch(`/api/shares/${encodeURIComponent(token)}`, {
          cache: 'no-store',
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        if (alive) setData(payload);
      } catch (cause) {
        if (alive)
          setError(
            cause instanceof Error ? cause.message : 'This report could not be loaded.',
          );
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  if (error)
    return (
      <Notice title="Student report unavailable">
        <Text style={s.parentCardText}>{error}</Text>
      </Notice>
    );

  if (!data) return <Notice title="Loading student learning dashboard…" />;

  const percentage = Math.round(
    (data.assessment.score / Math.max(1, data.assessment.maxMarks)) * 100,
  );

  return (
    <ScrollView contentContainerStyle={s.parentDashboard}>
      <View style={s.parentDashboardInner}>
        <View style={s.parentHero}>
          <BrandLogo style={s.parentHeroLogo} />
          <Text style={s.parentHeroEyebrow}>Student learning dashboard</Text>
          <Text accessibilityRole="header" style={s.parentHeroTitle}>
            {data.student.name}
          </Text>
          <Text style={s.parentSummaryLabel}>
            {data.student.className} · {data.assessment.subject}
          </Text>
        </View>

        <View style={s.parentSummary}>
          <Summary label="Assessment" value={data.assessment.title} />
          <Summary
            label="Score"
            value={`${data.assessment.score}/${data.assessment.maxMarks}`}
          />
          <Summary label="Percentage" value={`${percentage}%`} />
          <Summary label="Reports ready" value={String(data.resources.length + 1)} />
        </View>

        <View style={s.parentCard}>
          <Text accessibilityRole="header" style={s.parentSummaryValue}>
            Learning-gap report
          </Text>
          <Text style={s.parentCardText}>
            {data.assessment.feedback || 'Teacher-reviewed learning analysis.'}
          </Text>
          {(data.assessment.gaps || []).map((gap) => (
            <View key={gap.concept} style={s.parentGap}>
              <View style={s.parentGapHeader}>
                <Text style={s.parentSummaryValue}>{gap.concept}</Text>
                <Text style={s.parentSummaryLabel}>{gap.mastery}% mastery</Text>
              </View>
              {gap.finding ? <Text style={s.parentCardText}>{gap.finding}</Text> : null}
              {gap.rework ? <Text style={s.parentSummaryLabel}>{gap.rework}</Text> : null}
            </View>
          ))}
          <PrintButton label="Download or print report" />
        </View>

        {data.resources.map((resource) => (
          <View key={resource.id} style={s.parentCard}>
            <Text style={s.parentLabel}>{resource.type}</Text>
            <Text accessibilityRole="header" style={s.parentSummaryValue}>
              {resource.title}
            </Text>

            {resource.guide?.topics?.map((topic) => (
              <View key={topic.concept} style={s.parentGap}>
                <Text accessibilityRole="header" style={s.parentSummaryValue}>
                  {topic.concept}
                </Text>
                {topic.explanation ? (
                  <Text style={s.parentCardText}>{topic.explanation}</Text>
                ) : null}
                {topic.workedExample ? (
                  <>
                    <Text style={s.parentLabel}>Worked example</Text>
                    <Text style={s.parentCardText}>{topic.workedExample}</Text>
                  </>
                ) : null}
              </View>
            ))}

            {resource.content ? (
              <>
                <Text accessibilityRole="header" style={s.parentSummaryValue}>
                  Practice questions
                </Text>
                {[
                  ...(resource.content.mcqQuestions || []),
                  ...(resource.content.subjectiveQuestions || []),
                ].map((question, index) => (
                  <Text key={`${resource.id}-${index}`} style={s.parentCardText}>
                    {index + 1}. {question.question}
                  </Text>
                ))}
              </>
            ) : null}

            <PrintButton label="Download or print" />
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

/** The single-card page the error and loading states both render. */
function Notice({ title, children }: { title: string; children?: ReactNode }) {
  const s = useAppStyles();
  return (
    <ScrollView contentContainerStyle={s.parentDashboard}>
      <View style={[s.parentDashboardInner, s.parentCard]}>
        <Text accessibilityRole="header" style={s.parentHeroTitle}>
          {title}
        </Text>
        {children}
      </View>
    </ScrollView>
  );
}

/** One `.parent-summary article` - a caption over its figure. */
function Summary({ label, value }: { label: string; value: string }) {
  const s = useAppStyles();
  return (
    <View style={[s.parentSummaryTrack, s.parentSummaryCard]}>
      <Text style={s.parentSummaryLabel}>{label}</Text>
      <Text style={s.parentSummaryValue}>{value}</Text>
    </View>
  );
}

/** See note 3: the browser prints, and a device has nothing to print with. */
function PrintButton({ label }: { label: string }) {
  const s = useAppStyles();
  if (Platform.OS !== 'web') return null;
  return (
    <Pressable
      role="button"
      accessibilityLabel={label}
      onPress={() => window.print()}
      style={[s.parentCardButton, s.parentShareButton]}>
      <Text style={s.parentCardButtonText}>{label}</Text>
    </Pressable>
  );
}
