/**
 * One student's learning-gap report - the document a parent meeting is held
 * over, and the entry point to the study guide that answers it.
 *
 * Ported from `StudentGapsDialog` (frontend/app/ui/FunctionalEduAIApp.tsx:1379).
 *
 * ---------------------------------------------------------------------------
 * Two severity vocabularies, deliberately kept apart
 * ---------------------------------------------------------------------------
 * The executive summary is a *report* table, so it uses `masteryTone`, whose
 * three bands include "Secure". A gap *card* uses `gapSeverity`, which has only
 * two: a gap that has been closed is not listed as a gap, so captioning an
 * 85%-mastery gap "secure learning gap" would read as a contradiction. Both
 * come from `@/features/workspace/lib/analytics` and neither should be swapped
 * for the other.
 *
 * ---------------------------------------------------------------------------
 * Why the result is fetched again
 * ---------------------------------------------------------------------------
 * Publishing trims a result down to what the parent dashboard needs, so the
 * copy in the workspace snapshot may have lost its diagnostic findings and its
 * per-question decisions. `hydrateResult` puts them back before the report is
 * shown or downloaded, and returns the trimmed copy rather than throwing when
 * it cannot - a report that opens without its prose beats one that does not
 * open. The fetch is keyed on `fileId` and `published` rather than on the
 * `stored` object, which is rebuilt on every render of the shell.
 */

import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { downloadStudentLearningGapReport } from '@/features/documents/lib/downloads';
import { gapSeverity, masteryTone } from '@/features/workspace/lib/analytics';
import { hydrateResult } from '@/features/workspace/lib/read-model';
import { AppButton, ButtonRow } from '@/shared/components/buttons';
import { DialogHead } from '@/shared/components/primitives';
import { EmptyState } from '@/shared/components/status';
import { useResetOnChange } from '@/shared/hooks/use-reset-on-change';
import { useAppStyles } from '@/shared/theme/styles';
import type { Gap, GradeResult, UploadFile, W } from '@/shared/types/workspace';

/** `.xray-summary .metric` - the metric card on surface2 with a shorter floor. */
function SummaryMetric({ label, value, note }: { label: string; value: string; note: string }) {
  const s = useAppStyles();
  return (
    <View style={s.xraySummaryTrack}>
      <View style={[s.metric, s.xraySummaryMetric]}>
        <Text style={s.metricLabel}>{label}</Text>
        <Text style={s.metricValue}>{value}</Text>
        <Text style={s.metricCaption}>{note}</Text>
      </View>
    </View>
  );
}

/** One `<dl><div><dt/><dd/></div></dl>` row inside an executive-summary panel. */
function SummaryRow({ term, value, last }: { term: string; value: string; last?: boolean }) {
  const s = useAppStyles();
  return (
    <View style={[s.executiveSummaryRow, last && { borderBottomWidth: 0 }]}>
      <Text style={s.executiveSummaryTerm}>{term}</Text>
      <Text style={[s.executiveSummaryValue, { flexShrink: 1 }]}>{value}</Text>
    </View>
  );
}

/** One `<dl><div><dt/><dd/></div></dl>` cell inside a gap card's four-up body. */
function GapCell({ term, value, divided }: { term: string; value: string; divided: boolean }) {
  const s = useAppStyles();
  return (
    <View style={[s.diagnosticGapCell, divided && s.diagnosticGapCellDivided]}>
      <Text style={s.diagnosticGapTerm}>{term}</Text>
      <Text style={s.diagnosticGapDefinition}>{value}</Text>
    </View>
  );
}

export function StudentGapsDialog({
  assessment,
  open,
  fileId,
}: W<'assessment' | 'open'> & { fileId: string }) {
  const s = useAppStyles();
  const stored: GradeResult | undefined = assessment.gradeResults?.[fileId];
  const [full, setFull] = useState<GradeResult | undefined>(stored);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useResetOnChange(`${fileId}|${stored?.published}`, () => setFull(stored));

  useEffect(() => {
    if (!stored?.published) return;
    let alive = true;
    void hydrateResult(assessment.id, stored).then((next) => {
      if (alive) setFull(next);
    });
    return () => {
      alive = false;
    };
    // Keyed on identity rather than the `stored` object reference, which is
    // rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assessment.id, fileId, stored?.published]);

  const result = full;
  const file: UploadFile | undefined = (assessment.files || []).find((item) => item.id === fileId);

  if (!result)
    return (
      <>
        <DialogHead eyebrow={assessment.title} title="Learning gaps report" />
        <Text style={s.modalCopy}>
          This answer sheet has not been graded yet. Grade it first to unlock its learning gaps
          report.
        </Text>
        <AppButton
          variant="primary"
          full
          title="Grade this answer sheet"
          onPress={() => open(`grade-file:${fileId}`)}
        />
      </>
    );

  const sorted: Gap[] = result.gaps.slice().sort((a, b) => a.mastery - b.mastery);

  if (!sorted.length)
    return (
      <>
        <DialogHead
          eyebrow={`${result.studentName} · ${file?.name || 'Answer sheet'}`}
          title="Learning gaps report"
        />
        <EmptyState
          title="No evidence-supported learning gaps found"
          body="The analysis found no wrong, partially correct, incomplete or unanswered responses in the teacher-validated OCR text. Review the score and OCR evidence before approval."
        />
        <AppButton
          full
          title="Review validated OCR"
          onPress={() => open(`grade-file:${fileId}`)}
        />
      </>
    );

  const priority = sorted[0];
  const percentage = result.maxMarks ? Math.round((result.score / result.maxMarks) * 100) : 0;
  const performance =
    percentage >= 90
      ? 'Excellent'
      : percentage >= 75
        ? 'Good'
        : percentage >= 55
          ? 'Developing'
          : 'Priority support required';

  const download = async () => {
    setBusy(true);
    setError('');
    try {
      const detailed = await hydrateResult(assessment.id, result);
      await downloadStudentLearningGapReport(assessment, detailed, file);
    } catch (cause) {
      // The web ignored this. On a device the file is written and then handed
      // to the share sheet, and either half can fail with nothing on screen to
      // show for it, so the failure is reported rather than swallowed.
      setError(cause instanceof Error ? cause.message : 'The report could not be prepared.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DialogHead
        eyebrow={`${result.studentName} · ${file?.name || 'Answer sheet'}`}
        title="Learning gaps report"
      />

      <View style={[s.executiveSummary, s.studentExecutiveSummary]}>
        <Text style={s.eyebrow}>Executive summary</Text>
        <Text accessibilityRole="header" style={s.executiveSummaryTitle}>
          Student performance and priority learning gaps
        </Text>
        <View style={s.executiveSummaryGrid}>
          <View style={s.executiveSummaryPanel}>
            <Text style={s.executiveSummaryPanelTitle}>Student &amp; assessment details</Text>
            <SummaryRow term="Student" value={result.studentName} />
            <SummaryRow term="Class" value={`Class ${assessment.grade}${assessment.section}`} />
            <SummaryRow term="Subject" value={assessment.subject} />
            <SummaryRow term="Assessment" value={assessment.title} />
            <SummaryRow
              term="Marks"
              value={`${result.score}/${result.maxMarks} · ${percentage}%`}
            />
            <SummaryRow term="Overall performance" value={performance} last />
          </View>
          <View style={s.executiveSummaryPanel}>
            <Text style={s.executiveSummaryPanelTitle}>Learning-gap summary</Text>
            {sorted.map((gap, index) => (
              <SummaryRow
                key={gap.concept}
                term={gap.concept}
                value={`${gap.mastery}% · ${masteryTone(gap.mastery).label}`}
                last={index === sorted.length - 1}
              />
            ))}
          </View>
        </View>
      </View>

      <View style={s.xraySummary}>
        <SummaryMetric
          label="Score"
          value={`${result.score}/${result.maxMarks}`}
          note="AI-graded · teacher reviewable"
        />
        <SummaryMetric
          label="Priority gap"
          value={`${priority.mastery}%`}
          note={priority.concept}
        />
        <SummaryMetric
          label="Concepts assessed"
          value={String(result.gaps.length)}
          note={
            result.questionPaperName
              ? `Against ${result.questionPaperName}`
              : 'No question paper linked'
          }
        />
      </View>

      <View style={s.diagnosticGapList}>
        {sorted.map((gap, index) => (
          <View
            key={gap.concept}
            style={[s.diagnosticGapCard, gap.mastery < 55 && s.diagnosticGapCardCritical]}>
            <View style={s.diagnosticGapHeader}>
              <View style={s.diagnosticGapIndex}>
                <Text style={s.diagnosticGapIndexText}>{index + 1}</Text>
              </View>
              <View style={{ flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
                <Text style={s.diagnosticGapKicker}>{gapSeverity(gap)} learning gap</Text>
                <Text accessibilityRole="header" style={s.diagnosticGapTitle}>
                  {gap.concept}
                </Text>
              </View>
              <Text style={s.diagnosticGapMeta}>{gap.mastery}% mastery</Text>
            </View>
            <View style={s.diagnosticGapBody}>
              <GapCell
                term="Diagnostic finding"
                divided
                value={
                  gap.finding ||
                  `The response shows incomplete understanding of ${gap.concept}.`
                }
              />
              <GapCell
                term="Likely misunderstanding"
                divided={false}
                value={
                  gap.misconception ||
                  'The exact misconception was not captured in this earlier analysis. Reanalyse once to create the detailed diagnostic.'
                }
              />
              <GapCell
                term="Evidence from the answer"
                divided
                value={
                  gap.evidence ||
                  result.feedback ||
                  'Review the OCR answer and teacher feedback for supporting evidence.'
                }
              />
              <GapCell
                term="What the child needs to rework"
                divided={false}
                value={
                  gap.rework ||
                  `Revisit the core idea, then practise explaining and applying ${gap.concept}.`
                }
              />
            </View>
          </View>
        ))}
      </View>

      <Text style={s.modalCopy}>
        The study guide will cover all {sorted.length} identified topic
        {sorted.length === 1 ? '' : 's'}, ordered from the most urgent knowledge gap to the
        strongest area.
      </Text>
      {error ? (
        <View role="alert" style={s.formError}>
          <Text style={s.formErrorText}>{error}</Text>
        </View>
      ) : null}
      <ButtonRow>
        <AppButton
          title={busy ? 'Preparing report…' : 'Download PDF Learning Gap Report'}
          disabled={busy}
          onPress={() => void download()}
        />
        <AppButton title="Regrade this sheet" onPress={() => open(`grade-file:${fileId}`)} />
        <AppButton
          title="Generate study guide"
          variant="primary"
          onPress={() => open(`study-guide:${fileId}`)}
        />
      </ButtonRow>
    </>
  );
}
