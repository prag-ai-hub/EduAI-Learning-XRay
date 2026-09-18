/**
 * The Work module - every assessment as a card, and for the selected one the
 * decision card, its ten-stage journey and its uploaded evidence.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx `Work` (~453),
 * `AssessmentDecision` (~464) and `AssessmentJourney` (~470). The last two are
 * rendered nowhere else in the monolith, so they stay private to this file.
 *
 * The screen is assessment-first by design: the evidence-entry banner says
 * what creation captures, and nothing below it offers analysis until an
 * assessment is selected. The decision card's copy is chosen by what the
 * graded results already hold - teacher-graded, diagnosed, or neither - and
 * "View learning gaps" only reaches X-Ray once there is a diagnosis to show.
 *
 * `selected` is typed as an `Assessment`, but the shell derives it as
 * `state.assessments[0]` when nothing is chosen, which is undefined for a
 * teacher with no assessments. The guards below are the monolith's own.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTE
 * ---------------------------------------------------------------------------
 * `.work-grid` is `repeat(4,1fr)`, `repeat(2,1fr)` below 1050px and `1fr`
 * below 760px. `workTrack` already encodes those as a wrapping flex row, but a
 * wrapped row stretches a partly filled last line across the container where
 * the grid left the missing columns empty - one assessment would render as a
 * full-width card. `Grid.filler` holds those columns open, so the column count
 * is restated here from the same breakpoints `workTrack` branches on.
 *
 * The track style sits on the card itself rather than on a wrapper, so every
 * card in a row stretches to the tallest one, as grid items did.
 *
 * `.work-card:hover` doubles as the pressed state. It is listed after
 * `selectedCard` because it wins in the CSS too: `:hover` adds specificity, so
 * the lift shadow replaces the navy ring while the pointer is over the card.
 *
 * The `.filters` row is `FilterChips` (its `overflow:auto` is a horizontal
 * ScrollView) and the `.journey` strip is `JourneyStrip`, which owns the
 * five/three-column and phone-scroll layouts.
 */

import { useState } from 'react';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';

import { UploadedFiles } from '@/features/teacher/components/uploaded-files';
import { stageLabel, stageProgress } from '@/features/workspace/lib/demo-state';
import { AppButton, ButtonRow } from '@/shared/components/buttons';
import { CardHead, CardSpan2, PageHead, Progress } from '@/shared/components/primitives';
import { FilterChips, StatusPill } from '@/shared/components/status';
import { JourneyStrip, type JourneyStep } from '@/shared/components/table';
import { Grid, layoutFor, useAppStyles } from '@/shared/theme/styles';
import type { Assessment, DialogName, GradeResult, Stage, W } from '@/shared/types/workspace';

const FILTERS = ['All', 'Draft', 'Uploaded', 'Review', 'Published'] as const;

type Filter = (typeof FILTERS)[number];

const EVIDENCE_ROLES = [
  'Question paper · required',
  'Marking scheme',
  'Model answer',
  'Student answers',
];

/** The workflow in cycle order: the stage it completes, its label, the dialog it opens. */
const JOURNEY: readonly [Stage, string, DialogName][] = [
  ['draft', 'Assessment details', 'create-assessment'],
  ['uploaded', 'Student work', 'upload'],
  ['setup', 'Questions & rubric', 'setup'],
  ['grading', 'AI processing', 'process'],
  ['review', 'Teacher review', 'review-help'],
  ['approved', 'Final approval', 'approval'],
  ['xray', 'Learning X-Ray', 'xray-details'],
  ['intervention', 'Intervention', 'intervention-form'],
  ['followup', 'Follow-up', 'followup'],
  ['published', 'Publish grades', 'publish'],
];

export function Work({
  state,
  selected,
  openAssessment,
  open,
  update,
  notify,
}: W<'state' | 'selected' | 'openAssessment' | 'open' | 'update' | 'notify'>) {
  const s = useAppStyles();
  const { width } = useWindowDimensions();
  const size = layoutFor(width);
  const columns = size === 'compact' ? 1 : size === 'medium' ? 2 : 4;

  const [filter, setFilter] = useState<Filter>('All');
  // A substring match on the stage label, ignoring case. The web's was
  // case-sensitive, so its "Review" chip matched nothing - the label is
  // "Teacher review". Checked against every label: no other chip gains a match.
  const list = state.assessments.filter(
    (a: Assessment) =>
      filter === 'All' || stageLabel[a.stage].toLowerCase().includes(filter.toLowerCase()),
  );
  const fillers = (columns - (list.length % columns)) % columns;

  return (
    <>
      <PageHead
        eyebrow="Teacher workspace"
        title="Work & evidence"
        subtitle="Create the assessment and attach its required reference documents before adding student answer sheets.">
        <AppButton
          variant="primary"
          icon="＋"
          title="Create assessment"
          onPress={() => open('create-assessment')}
        />
      </PageHead>

      <View style={s.dashboardGrid}>
        {/* Inside the grid rather than above it, so the gap to the filters card is
            the grid's 18px - as a sibling of the grid it sat flush against it. */}
        <CardSpan2 style={s.evidenceEntry}>
          <View style={[s.evidenceEntryBody, { flexShrink: 1 }]}>
            <Text style={s.eyebrow}>Assessment-first evidence</Text>
            <Text accessibilityRole="header" style={s.cardTitle}>
              Keep every analysis grounded in the assessment
            </Text>
            <Text style={s.cardBody}>
              Creation now captures Class 1–12, the compulsory question paper, and optional marking
              scheme and model answer. Add student answer sheets after saving.
            </Text>
          </View>
          <View style={s.evidenceRoleList}>
            {EVIDENCE_ROLES.map((role) => (
              <View key={role} style={s.evidenceRoleTag}>
                <Text style={s.evidenceRoleTagText}>{role}</Text>
              </View>
            ))}
          </View>
        </CardSpan2>

        <CardSpan2>
          <FilterChips
            options={FILTERS}
            value={filter}
            onChange={setFilter}
            accessibilityLabel="Filter assessments by stage"
          />
          <View style={s.workGrid}>
            {list.map((a: Assessment) => {
              const isSelected = selected?.id === a.id;
              return (
                <Pressable
                  key={a.id}
                  role="button"
                  accessibilityLabel={`${a.title}, Class ${a.grade}${a.section} · ${a.subject}, ${stageLabel[a.stage]}`}
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => openAssessment(a.id)}
                  style={({ hovered, pressed }) => [
                    s.workTrack,
                    s.workCard,
                    isSelected && s.selectedCard,
                    (hovered || pressed) && s.workCardHover,
                  ]}>
                  <View style={s.miniPaper}>
                    <View style={s.miniPaperLine} />
                    <View style={s.miniPaperLine} />
                    <View style={s.miniPaperLine} />
                  </View>
                  <Text style={s.workCardTitle}>{a.title}</Text>
                  <Text style={s.workCardCaption}>
                    Class {a.grade}
                    {a.section} · {a.subject}
                  </Text>
                  <Progress value={Math.round(stageProgress(a.stage))} />
                  <Text style={s.workCardAction}>{stageLabel[a.stage]} →</Text>
                </Pressable>
              );
            })}
            {Array.from({ length: fillers }, (_, i) => (
              <View key={`filler-${i}`} style={Grid.filler(columns)} />
            ))}
          </View>
        </CardSpan2>

        {selected ? (
          <AssessmentDecision assessment={selected} open={open} openAssessment={openAssessment} />
        ) : null}
        {selected ? <AssessmentJourney assessment={selected} open={open} /> : null}
        {selected ? (
          <UploadedFiles assessment={selected} update={update} notify={notify} open={open} />
        ) : null}
      </View>
    </>
  );
}

function AssessmentDecision({
  assessment: a,
  open,
  openAssessment,
}: W<'assessment' | 'open' | 'openAssessment'>) {
  const s = useAppStyles();

  const results = Object.values(a.gradeResults || {}) as GradeResult[];
  // A diagnosis-only run records gaps with `gradingSkipped` set, so "diagnosed"
  // is any result at all and "graded" is a result that was actually marked.
  const graded = results.some((result) => !result.gradingSkipped);
  const diagnosed = results.length > 0;
  const learningGaps = () =>
    diagnosed ? openAssessment(a.id, 'X-Ray') : openAssessment(a.id, 'Review');

  return (
    <CardSpan2 style={s.decisionCard}>
      <View style={{ flexShrink: 1 }}>
        <Text style={s.eyebrow}>Choose an action</Text>
        <Text accessibilityRole="header" style={s.cardTitle}>
          {graded
            ? 'Graded evidence is ready'
            : diagnosed
              ? 'Learning-gap diagnosis is ready'
              : 'Open this assessment in Review'}
        </Text>
        <Text style={[s.cardBody, s.decisionCardBody]}>
          {graded
            ? 'Open the selected assessment directly in Review or view its learning-gap analysis.'
            : diagnosed
              ? 'Open the selected assessment in Review or continue to learning-gap analysis.'
              : 'Assessment and student evidence open directly in Review. No OCR confirmation pop-up is shown from these actions.'}
        </Text>
      </View>
      <ButtonRow>
        <AppButton
          variant="primary"
          title="Analyse Assessment"
          onPress={() => openAssessment(a.id, 'Review')}
        />
        <AppButton
          title="Check Multiple Students"
          onPress={() => openAssessment(a.id, 'Review')}
        />
        <AppButton title="View learning gaps" onPress={learningGaps} />
        <AppButton
          variant="danger"
          title="Delete Assessment"
          onPress={() => open('delete-assessment')}
        />
      </ButtonRow>
    </CardSpan2>
  );
}

function AssessmentJourney({ assessment: a, open }: W<'assessment' | 'open'>) {
  // `stageLabel`'s key order is the cycle order; see its declaration.
  const current = Object.keys(stageLabel).indexOf(a.stage);

  // Verbatim from the web: the current stage is styled done and captioned
  // "Complete", yet keeps its number rather than a tick, and the step after it
  // carries the orange "current" ring.
  const steps: JourneyStep[] = JOURNEY.map(([stage, label, action], i) => ({
    key: stage,
    label,
    caption: i <= current ? 'Complete' : 'Open step',
    state: i <= current ? 'done' : i === current + 1 ? 'current' : 'todo',
    glyph: i < current ? '✓' : String(i + 1),
    onPress: () => open(action),
  }));

  return (
    <CardSpan2>
      <CardHead eyebrow="End-to-end workflow" title={a.title}>
        <StatusPill tone="success">{`Version ${a.version}`}</StatusPill>
      </CardHead>
      <JourneyStrip steps={steps} />
    </CardSpan2>
  );
}
