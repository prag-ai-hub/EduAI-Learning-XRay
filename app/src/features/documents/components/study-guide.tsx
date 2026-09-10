/**
 * The targeted study guide - one student's recovery plan, built from the
 * evidence that diagnosed the gaps.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx `StudyGuideDialog`
 * (~1059-1100).
 *
 * The dialog refuses to open on an ungraded sheet, and that refusal is the
 * point: a guide written without a diagnosed gap is placeholder content wearing
 * a student's name. Generation is also a save - the guide is written into the
 * workspace resources the moment it comes back, before the teacher approves
 * anything, so a closed dialog never loses a generated plan.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTE
 * ---------------------------------------------------------------------------
 * The progress ticker was `window.setInterval`; there is no `window` on a
 * device, so it is the plain global. The PDF is produced by
 * `@/features/documents/lib/downloads`, which owns the web-only jsPDF path -
 * nothing here touches a PDF library.
 */

import { useState } from 'react';
import { Text, View } from 'react-native';

import { authFetch } from '@/features/auth/api/authApi';
import { downloadStudyGuide } from '@/features/documents/lib/downloads';
import { PdfUnavailableError } from '@/features/documents/lib/pdf';
import { inferDocumentRole } from '@/features/workspace/lib/documents';
import { BrandDocumentHeader } from '@/shared/components/brand';
import { AppButton, ButtonRow } from '@/shared/components/buttons';
import { Field, FormError } from '@/shared/components/form';
import { DialogHead, Progress } from '@/shared/components/primitives';
import { useAppStyles } from '@/shared/theme/styles';
import type {
  DemoState,
  Gap,
  GradeResult,
  StudyGuide,
  StudyGuideTopic,
  UploadFile,
  W,
  Worksheet,
} from '@/shared/types/workspace';

/** "Question paper · Term 2 QP.pdf" - how a source file is named on the page. */
function evidenceLabel(file: UploadFile, separator: string): string {
  return `${file.documentRole || inferDocumentRole(file.name)}${separator}${file.name}`;
}

/** `<ol>` - a numbered step, which React Native has no list element for. */
function Step({ index, text }: { index: number; text: string }) {
  const s = useAppStyles();
  return <Text style={s.guideLearningBody}>{`${index + 1}. ${text}`}</Text>;
}

export function StudyGuideDialog({
  assessment,
  fileId,
  open,
  setState,
  done,
}: W<'assessment' | 'open' | 'setState' | 'done'> & { fileId?: string }) {
  const s = useAppStyles();
  const result: GradeResult | undefined = fileId ? assessment.gradeResults?.[fileId] : undefined;
  const gap = result?.gaps.slice().sort((a, b) => a.mastery - b.mastery)[0];

  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [guide, setGuide] = useState<StudyGuide | null>(null);
  const [error, setError] = useState('');

  if (!gap) {
    return (
      <>
        <DialogHead eyebrow={assessment.title} title="Targeted study guide" />
        <Text style={s.modalCopy}>
          {`No graded evidence is available yet for ${assessment.subject}. Grade at least one answer sheet first so the study guide can target a real learning gap instead of placeholder content.`}
        </Text>
      </>
    );
  }

  const concept = gap.concept;

  const generate = async () => {
    setGenerating(true);
    setError('');
    setProgress(5);
    const started = Date.now();
    const progressTimer = setInterval(
      () => setProgress(Math.min(92, 8 + Math.round((Date.now() - started) / 500))),
      1000,
    );
    try {
      const response = await authFetch('/api/generate-study-guide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: assessment.subject,
          concept,
          studentName: result?.studentName,
          mastery: gap.mastery,
          gaps: result?.gaps,
          feedback: result?.feedback,
          ocrText: result?.ocrText,
          evidenceFiles: assessment.files.map((file) => evidenceLabel(file, ': ')),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Study-guide generation failed');
      setProgress(100);
      setGuide(payload.guide);
      const saved: Worksheet = {
        id: `guide-${assessment.id}-${fileId}`,
        title: payload.guide.title,
        type: 'Study Guide',
        status: 'Saved',
        subject: assessment.subject,
        grade: assessment.grade,
        assessmentId: assessment.id,
        concepts: (result?.gaps || []).map((g: Gap) => g.concept),
        guide: payload.guide,
        studentName: result?.studentName,
        evidenceFiles: assessment.files.map((file) => evidenceLabel(file, ' · ')),
      };
      setState((state: DemoState) => ({
        ...state,
        resources: [saved, ...state.resources.filter((r) => r.id !== saved.id)],
        events: [`Study guide saved · ${saved.title}`, ...state.events],
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Study-guide generation failed');
    } finally {
      clearInterval(progressTimer);
      setGenerating(false);
    }
  };

  const download = () => {
    if (!guide) return;
    // Reported, not swallowed. On a device every PDF entry point raises
    // `PdfUnavailableError` - the renderer is jsPDF and there is no DOM - so a
    // bare `void` here left the teacher pressing a button that did nothing and
    // said nothing. The generated guide is still on screen either way.
    void downloadStudyGuide(
      {
        title: guide.title,
        subject: assessment.subject,
        grade: assessment.grade,
        studentName: result?.studentName,
        evidenceFiles: assessment.files.map((file) => evidenceLabel(file, ' · ')),
      },
      guide,
    ).catch((reason) =>
      setError(
        reason instanceof PdfUnavailableError
          ? 'Downloading the study guide is only available on the web build for now.'
          : 'The study guide could not be saved. Try again.',
      ),
    );
  };

  const gapCount = result?.gaps.length || 1;
  const topics: StudyGuideTopic[] = guide?.topics || [];

  return (
    <>
      <DialogHead
        eyebrow={`${result ? `${result.studentName} · ` : ''}Learning recovery plan · ${assessment.title}`}
        title="Complete study guide"
      />
      <Text style={s.modalCopy}>
        {`This guide covers all ${gapCount} diagnosed learning gap${gapCount === 1 ? '' : 's'}, beginning with the weakest topic. Every section is grounded in the uploaded evidence and diagnostic findings.`}
      </Text>

      {!guide ? (
        <AppButton
          full
          title={generating ? 'Generating evidence-based guide…' : 'Generate and save study guide'}
          disabled={generating}
          onPress={() => void generate()}
        />
      ) : null}

      {generating ? (
        <>
          <Progress value={progress} />
          <Text style={s.modalCopy}>
            {`Server generation in progress · ${progress}% · safe to switch tabs`}
          </Text>
        </>
      ) : null}

      <FormError>{error}</FormError>

      {guide ? (
        <>
          <View style={s.brandedDocument}>
            <BrandDocumentHeader
              label="Personalised study guide"
              title={guide.title}
              meta={`${assessment.subject} · ${result?.studentName || 'Student'} · ${topics.length} topic plan`}
            />
            {guide.overview ? (
              <View style={s.guideOverview}>
                <Text style={s.guideOverviewText}>{guide.overview}</Text>
              </View>
            ) : null}

            <View
              style={s.guideTopicIndex}
              accessibilityRole="list"
              accessibilityLabel="Study guide topics">
              {topics.map((topic, index) => (
                <View key={topic.concept} style={s.guideTopicIndexItem}>
                  <View style={s.guideTopicIndexBadge}>
                    <Text style={s.guideTopicIndexBadgeText}>{index + 1}</Text>
                  </View>
                  <View style={{ flexShrink: 1 }}>
                    <Text style={s.guideTopicIndexTitle}>{topic.concept}</Text>
                    <Text style={s.guideTopicIndexCaption}>
                      {`${topic.mastery}% starting mastery`}
                    </Text>
                  </View>
                </View>
              ))}
            </View>

            <View style={s.sourceRibbon}>
              <Text style={[s.sourceRibbonText, s.labelText]}>Built from</Text>
              {assessment.files.map((file) => (
                <View key={file.id} style={s.sourceRibbonTag}>
                  <Text style={s.sourceRibbonText}>{evidenceLabel(file, ' · ')}</Text>
                </View>
              ))}
            </View>

            <View style={s.guideTopicSections}>
              {topics.map((topic, index) => (
                <View key={topic.concept} style={s.guideTopicSection}>
                  <View style={s.guideTopicSectionHeader}>
                    <View style={{ flexShrink: 1 }}>
                      <Text style={s.guideTopicSectionKicker}>{`Topic ${index + 1}`}</Text>
                      <Text accessibilityRole="header" style={s.guideTopicSectionTitle}>
                        {topic.concept}
                      </Text>
                    </View>
                    <Text style={s.guideTopicSectionMeta}>{`${topic.mastery}%`}</Text>
                  </View>

                  <View style={s.diagnosisCallout}>
                    <Text style={s.diagnosisCalloutTitle}>Why this is a learning gap</Text>
                    <Text style={s.diagnosisCalloutBody}>{topic.diagnosis}</Text>
                  </View>

                  <View style={s.guideLearningGrid}>
                    <View style={[s.guideLearningTrack, s.guideLearningCard]}>
                      <Text style={s.guideLearningTitle}>Learning objective</Text>
                      <Text style={s.guideLearningBody}>{topic.learningObjective}</Text>
                    </View>
                    <View style={[s.guideLearningTrack, s.guideLearningCard]}>
                      <Text style={s.guideLearningTitle}>Clear explanation</Text>
                      <Text style={s.guideLearningBody}>{topic.explanation}</Text>
                    </View>
                    <View style={[s.guideLearningSpan2, s.guideLearningCard]}>
                      <Text style={s.guideLearningTitle}>Worked example</Text>
                      <Text style={s.guideLearningBody}>{topic.workedExample}</Text>
                    </View>
                    <View style={[s.guideLearningTrack, s.guideLearningCard]}>
                      <Text style={s.guideLearningTitle}>Guided practice</Text>
                      {(topic.practiceSteps || []).map((step, i) => (
                        <Step key={step} index={i} text={step} />
                      ))}
                    </View>
                    <View style={[s.guideLearningTrack, s.guideLearningCard]}>
                      <Text style={s.guideLearningTitle}>Check for understanding</Text>
                      {(topic.checkForUnderstanding || []).map((step, i) => (
                        <Step key={step} index={i} text={step} />
                      ))}
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </View>

          <Field
            label="Teacher instructions"
            type="textarea"
            defaultValue={`Use this ${assessment.subject} guide to address ${concept}. Ask the student to explain the evidence behind each response.`}
          />

          <ButtonRow>
            <AppButton title="Download branded PDF study guide" onPress={download} />
            <AppButton title="Regenerate" disabled={generating} onPress={() => void generate()} />
            {fileId ? (
              <AppButton
                variant="primary"
                title="Continue to practice worksheet →"
                onPress={() => open(`worksheet-gap:${fileId}`)}
              />
            ) : (
              <AppButton variant="primary" title="Approve & save" onPress={done} />
            )}
          </ButtonRow>
        </>
      ) : null}
    </>
  );
}
