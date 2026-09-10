/**
 * The Resource library - every analysed student, filtered by class, subject and
 * assessment, with the four documents that belong to them.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx `ResourcesView` (~635).
 *
 * The three filters cascade in one direction only, exactly as they did:
 * choosing a class resets subject and assessment, choosing a subject resets the
 * assessment. That is what stops the picker offering a subject the chosen class
 * does not teach.
 *
 * A published result or resource is trimmed in the workspace blob, so every
 * download hydrates first (`hydrateResult` / `hydrateResource`) - without it a
 * report opens with its headings and none of its diagnostic prose.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTE
 * ---------------------------------------------------------------------------
 * `.resource-row` is a four-track grid with a 760px floor on a phone. Here it
 * is `ResourceRow` from `@/shared/components/table`, which assigns those tracks
 * by child position, inside a horizontal ScrollView - what `overflow-x: auto`
 * did.
 *
 * The web mutated the ZIP button's own `textContent` to report progress
 * ("Checking all reports…", "Preparing four PDFs…"). There is no `textContent`
 * to write to here, so each row owns a small button component that keeps the
 * label in state; the wording and the order are unchanged.
 *
 * PDF generation is web-only (see `@/features/documents/lib/pdf`), so every
 * download is wrapped and its failure raised as a toast rather than an unhandled
 * rejection - which is what the bare `onClick={() => download…()}` calls left
 * behind on the web.
 */

import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import {
  downloadAnswerKey,
  downloadAssessmentZip,
  downloadStudentLearningGapReport,
  downloadStudyGuide,
  downloadWorksheet,
} from '@/features/documents/lib/downloads';
import { hydrateResource, hydrateResult } from '@/features/workspace/lib/read-model';
import { generateAllStudentResources } from '@/features/workspace/lib/resources';
import { AppButton, LinkButton } from '@/shared/components/buttons';
import { Select } from '@/shared/components/form';
import { Card, PageHead } from '@/shared/components/primitives';
import { EmptyState } from '@/shared/components/status';
import { ResourceRow } from '@/shared/components/table';
import { useAppStyles } from '@/shared/theme/styles';
import type {
  Assessment,
  GradeResult,
  Notify,
  SetWorkspace,
  W,
  Worksheet,
} from '@/shared/types/workspace';

const ALL_CLASSES = 'All classes';
const ALL_SUBJECTS = 'All subjects';
const ALL_ASSESSMENTS = 'All assessments';

type ResourceRowData = {
  assessment: Assessment;
  result: GradeResult;
  guide?: Worksheet;
  worksheet?: Worksheet;
};

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

type ResourceRowProps = { setState: SetWorkspace; notify: Notify };

/**
 * "Download All (ZIP)" - generates whatever is missing, hydrates both bodies,
 * then zips four PDFs. The label is the progress indicator, as on the web.
 */
function DownloadAllButton({
  row,
  setState,
  notify,
}: ResourceRowProps & { row: ResourceRowData }) {
  const [label, setLabel] = useState('Download All (ZIP)');
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setLabel('Checking all reports…');
    try {
      const complete =
        row.guide && row.worksheet
          ? { guide: row.guide, worksheet: row.worksheet }
          : await generateAllStudentResources(row.assessment, row.result, setState);
      setLabel('Preparing four PDFs…');
      const [fullGuide, fullWorksheet] = await Promise.all([
        hydrateResource(complete.guide),
        hydrateResource(complete.worksheet),
      ]);
      await downloadAssessmentZip(row.assessment, row.result, fullGuide, fullWorksheet);
    } catch (error) {
      notify(message(error, 'Report bundle download failed'), 'error');
    } finally {
      setBusy(false);
      setLabel('Download All (ZIP)');
    }
  };

  return (
    <AppButton variant="primary" title={label} disabled={busy} onPress={() => void run()} />
  );
}

export function ResourcesView({
  state,
  setState,
  open,
  notify,
}: W<'state' | 'setState' | 'open' | 'notify'>) {
  const s = useAppStyles();
  const [classFilter, setClassFilter] = useState(ALL_CLASSES);
  const [subjectFilter, setSubjectFilter] = useState(ALL_SUBJECTS);
  const [assessmentFilter, setAssessmentFilter] = useState(ALL_ASSESSMENTS);

  const classes = Array.from(
    new Set(state.assessments.map((a: Assessment) => `Class ${a.grade}${a.section}`)),
  ).sort();
  const subjects = Array.from(
    new Set(
      state.assessments
        .filter(
          (a: Assessment) =>
            classFilter === ALL_CLASSES || `Class ${a.grade}${a.section}` === classFilter,
        )
        .map((a: Assessment) => a.subject),
    ),
  ).sort();
  const assessments: Assessment[] = state.assessments.filter(
    (a: Assessment) =>
      (classFilter === ALL_CLASSES || `Class ${a.grade}${a.section}` === classFilter) &&
      (subjectFilter === ALL_SUBJECTS || a.subject === subjectFilter),
  );

  const rows: ResourceRowData[] = assessments
    .filter((a) => assessmentFilter === ALL_ASSESSMENTS || a.id === assessmentFilter)
    .flatMap((a) =>
      Object.values(a.gradeResults || {}).map((result) => {
        const guide = state.resources.find(
          (r: Worksheet) =>
            r.type === 'Study Guide' &&
            (r.assessmentId === a.id || r.id === `guide-${a.id}-${result.fileId}`) &&
            (r.studentName === result.studentName || !r.studentName),
        );
        const worksheet = state.resources.find(
          (r: Worksheet) =>
            r.type !== 'Study Guide' &&
            (r.assessmentId === a.id || r.id.includes(`${a.id}-${result.fileId}`)) &&
            (r.studentName === result.studentName || !r.studentName),
        );
        return { assessment: a, result, guide, worksheet };
      }),
    );

  const downloadReport = async (assessment: Assessment, result: GradeResult) => {
    try {
      const detailed = await hydrateResult(assessment.id, result);
      await downloadStudentLearningGapReport(assessment, detailed);
    } catch (error) {
      notify(message(error, 'The learning gap report could not be exported.'), 'error');
    }
  };

  const downloadGuide = async (guide: Worksheet) => {
    try {
      const full = await hydrateResource(guide);
      await downloadStudyGuide(full, full.guide);
    } catch (error) {
      notify(message(error, 'The study guide could not be exported.'), 'error');
    }
  };

  const downloadSheet = async (worksheet: Worksheet, answerKey: boolean) => {
    try {
      const full = await hydrateResource(worksheet);
      await (answerKey
        ? downloadAnswerKey(full, full.content)
        : downloadWorksheet(full, full.content));
    } catch (error) {
      notify(message(error, 'The worksheet could not be exported.'), 'error');
    }
  };

  return (
    <>
      <PageHead
        eyebrow="Saved reports & learning materials"
        title="Resource library"
        subtitle="Filter by class, subject and assessment, then download each student's report and learning materials.">
        <AppButton
          variant="primary"
          icon="＋"
          title="Create worksheet"
          onPress={() => open('worksheet')}
        />
      </PageHead>

      <Card style={s.resourceLibrary}>
        <View style={s.resourceFilters} accessibilityLabel="Resource filters">
          <View style={s.resourceFilterTrack}>
            <Select
              label="Class"
              title="Filter resources by class"
              options={[ALL_CLASSES, ...classes]}
              value={classFilter}
              onValueChange={(next) => {
                setClassFilter(next);
                setSubjectFilter(ALL_SUBJECTS);
                setAssessmentFilter(ALL_ASSESSMENTS);
              }}
            />
          </View>
          <View style={s.resourceFilterTrack}>
            <Select
              label="Subject"
              title="Filter resources by subject"
              options={[ALL_SUBJECTS, ...subjects]}
              value={subjectFilter}
              onValueChange={(next) => {
                setSubjectFilter(next);
                setAssessmentFilter(ALL_ASSESSMENTS);
              }}
            />
          </View>
          <View style={s.resourceFilterTrack}>
            <Select
              label="Assessment"
              title="Filter resources by assessment"
              options={[
                { label: ALL_ASSESSMENTS, value: ALL_ASSESSMENTS },
                ...assessments.map((a) => ({ label: a.title, value: a.id })),
              ]}
              value={assessmentFilter}
              onValueChange={setAssessmentFilter}
            />
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ flexGrow: 1 }}>
          <View
            style={[s.resourceTable, { flexGrow: 1 }]}
            role="table"
            accessibilityLabel="Student reports and documents">
            {/* Plain strings, not <Text>: a head row styles a string child with
                `.resource-head` and passes anything else through untouched. */}
            <ResourceRow head>
              {'Student name'}
              {'Learning gap report'}
              {'Study guide'}
              {'Worksheet & answer key'}
            </ResourceRow>

            {!rows.length ? (
              <EmptyState
                title="No analysed students match these filters"
                body="Grade an answer sheet or change the filters to view downloadable resources."
              />
            ) : null}

            {rows.map((row, index) => {
              const { assessment, result, guide, worksheet } = row;
              return (
                <ResourceRow
                  key={`${assessment.id}-${result.fileId}`}
                  last={index === rows.length - 1}>
                  <View>
                    <Text style={s.resourceRowTitle}>{result.studentName}</Text>
                    <Text style={s.resourceRowCaption}>
                      Class {assessment.grade}
                      {assessment.section} · {assessment.subject}
                      {'\n'}
                      {assessment.title}
                    </Text>
                    <DownloadAllButton row={row} setState={setState} notify={notify} />
                    <AppButton
                      icon="▦"
                      title="Share with parent"
                      style={s.parentShareButton}
                      onPress={() => open(`parent-share:${assessment.id}:${result.fileId}`)}
                    />
                  </View>

                  <LinkButton
                    title="Download report"
                    onPress={() => void downloadReport(assessment, result)}
                  />

                  {guide ? (
                    <LinkButton
                      title="Download study guide"
                      onPress={() => void downloadGuide(guide)}
                    />
                  ) : (
                    <Text style={s.resourceRowCaption}>Not created</Text>
                  )}

                  {worksheet ? (
                    <View style={s.resourceActions}>
                      <LinkButton
                        title="Worksheet"
                        onPress={() => void downloadSheet(worksheet, false)}
                      />
                      <LinkButton
                        title="Answer key"
                        onPress={() => void downloadSheet(worksheet, true)}
                      />
                    </View>
                  ) : (
                    <Text style={s.resourceRowCaption}>Not created</Text>
                  )}
                </ResourceRow>
              );
            })}
          </View>
        </ScrollView>
      </Card>
    </>
  );
}
