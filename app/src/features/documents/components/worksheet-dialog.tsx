/**
 * The learning-gap resource studio: a targeted practice worksheet, built to
 * cover every gap a graded answer sheet diagnosed.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx `WorksheetDialog` (~1420).
 *
 * The registry opens it three ways. `worksheet-gap` comes from a graded sheet
 * and presets the concept, title and student from its weakest gap; `worksheet`
 * starts blank against the selected assessment; `worksheet-edit` reopens a
 * saved resource. All three are the same form, because the only thing that
 * differs is where the initial values come from.
 *
 * Coverage is checked twice, and neither check is optional. Before the call the
 * question count has to be at least the number of topics, since a sheet with
 * fewer questions than gaps cannot cover them all. After it, every topic has to
 * appear on at least one returned question: the model is asked to spread the
 * questions across every concept and does not always do so, and a worksheet
 * that silently drops a gap is worse than an error the teacher can regenerate.
 *
 * Generation is also a save, as it is for the study guide: the worksheet lands
 * in Resources the moment it comes back, so a closed dialog never loses it.
 * Approving then marks that same resource approved.
 *
 * The Language select and the two "Include…" boxes are unnamed and never reach
 * the request - exactly as on the web, where they were uncontrolled inputs that
 * nothing read.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTE
 * ---------------------------------------------------------------------------
 * * The web had no `<form>` here, only buttons with click handlers, so the
 *   `required`, `min` and `max` on its inputs never ran - the disabled state on
 *   the generate button did all the gating. The fields are wrapped in `Form` so
 *   Enter in a field behaves like a browser's implicit submit, which means
 *   those constraints are now enforced when it fires.
 * * A number input is a text input with a numeric keyboard. Anything that is
 *   not a number reads as 0, which is what `Number(e.target.value)` produced
 *   from the browser's empty value for the same input.
 * * The progress ticker was `window.setInterval`; there is no `window` on a
 *   device. The PDFs come from `@/features/documents/lib/downloads`, which owns
 *   the web-only jsPDF path, so nothing here touches a PDF library.
 */

import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { authFetch } from '@/features/auth/api/authApi';
import { WorksheetPreview } from '@/features/documents/components/worksheet-preview';
import { downloadAnswerKey, downloadWorksheet } from '@/features/documents/lib/downloads';
import { PdfUnavailableError } from '@/features/documents/lib/pdf';
import { logApiTiming } from '@/features/workspace/lib/analytics';
import { inferDocumentRole } from '@/features/workspace/lib/documents';
import {
  Checkbox,
  Field,
  Form,
  FormError,
  FormGrid,
  Select,
  SubmitButton,
} from '@/shared/components/form';
import { DialogHead, Progress } from '@/shared/components/primitives';
import { FontWeight, useAppStyles } from '@/shared/theme/styles';
import type {
  Assessment,
  DemoState,
  Gap,
  GradeResult,
  UploadFile,
  W,
  Worksheet,
  WorksheetContent,
} from '@/shared/types/workspace';

const TEMPLATES = [
  { name: 'Guided recovery', caption: 'Scaffolds + worked example' },
  { name: 'Quick check', caption: 'Short follow-up' },
  { name: 'Exam practice', caption: 'Mixed assessment style' },
  { name: 'Challenge & extend', caption: 'Deeper transfer tasks' },
];

const DIFFICULTIES = ['Mixed', 'Foundation', 'Challenge'];

const LANGUAGES = ['English', 'Hindi'];

/** A typed question count. Not-a-number is 0, as the browser's empty value was. */
function toCount(text: string): number {
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function WorksheetDialog({
  setState,
  worksheet,
  sourceAssessment,
  sourceResult,
  presetConcept,
  presetTitle,
  presetStudent,
  done,
}: W<'setState' | 'done'> & {
  worksheet?: Worksheet;
  sourceAssessment?: Assessment;
  sourceResult?: GradeResult;
  presetConcept?: string;
  presetTitle?: string;
  presetStudent?: string;
}) {
  const s = useAppStyles();
  const concept = worksheet?.concept || presetConcept || 'the target concept';
  const topics: string[] =
    worksheet?.concepts || sourceResult?.gaps?.map((g: Gap) => g.concept) || [concept];

  const [subject, setSubject] = useState(worksheet?.subject || sourceAssessment?.subject || '');
  const [grade, setGrade] = useState(worksheet?.grade || sourceAssessment?.grade || '');
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [genError, setGenError] = useState('');
  const [content, setContent] = useState<WorksheetContent | null>(worksheet?.content || null);
  const [template, setTemplate] = useState(worksheet?.template || 'Guided recovery');
  const [mcq, setMcq] = useState(worksheet?.mcq ?? Math.max(6, topics.length * 2));
  const [subjective, setSubjective] = useState(worksheet?.subjective ?? Math.max(4, topics.length));
  const [difficulty, setDifficulty] = useState(worksheet?.difficulty || 'Mixed');
  const [title, setTitle] = useState(
    worksheet?.title || presetTitle || `${topics.join(', ')} Practice`,
  );
  // The resource id generation last saved under. The web approved into a fresh
  // `r<timestamp>` id instead, so a newly generated worksheet appeared in
  // Resources twice - the "Saved" copy and the "Approved" one. Remembering the
  // id makes Approve and Regenerate update the one resource.
  const [savedId, setSavedId] = useState<string | undefined>(worksheet?.id);

  // `generated` was separate state on the web, but it was only ever set
  // together with `content`, so it is derived rather than kept in step by hand.
  const generated = Boolean(content);

  const resourceFields = (id: string, status: string, body: WorksheetContent | undefined) => ({
    id,
    title,
    type: 'Targeted worksheet',
    status,
    template,
    concept: topics[0],
    concepts: topics,
    subject,
    grade,
    assessmentId: worksheet?.assessmentId || sourceAssessment?.id,
    studentName: worksheet?.studentName || presetStudent,
    mcq,
    subjective,
    difficulty,
    answerSheets: worksheet?.answerSheets || 0,
    gradedSheets: worksheet?.gradedSheets || 0,
    content: body,
  });

  const save = () => {
    const resource: Worksheet = resourceFields(
      savedId || `r${Date.now()}`,
      'Approved',
      content || worksheet?.content,
    );
    setState((state: DemoState) => ({
      ...state,
      resources: state.resources.some((r) => r.id === resource.id)
        ? state.resources.map((r) => (r.id === resource.id ? resource : r))
        : [resource, ...state.resources],
      events: [`Worksheet saved · ${resource.title}`, ...state.events],
    }));
    done();
  };

  const generate = async () => {
    setGenError('');
    setGenerating(true);
    setProgress(5);
    const started = Date.now();
    const progressTimer = setInterval(
      () => setProgress(Math.min(92, 8 + Math.round((Date.now() - started) / 500))),
      1000,
    );
    try {
      if (!subject.trim() || !grade.trim()) throw new Error('Subject and Class are required.');
      if (mcq + subjective < topics.length)
        throw new Error(
          `Add at least ${topics.length} questions so every identified learning-gap topic is covered.`,
        );
      const evidenceSummary = [
        sourceResult?.feedback,
        sourceResult?.ocrText,
        sourceAssessment?.files
          ?.map(
            (file: UploadFile) => `${file.documentRole || inferDocumentRole(file.name)}: ${file.name}`,
          )
          .join('\n'),
      ]
        .filter(Boolean)
        .join('\n\n');
      const res = await authFetch('/api/generate-worksheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          concept: topics[0],
          concepts: topics,
          subject,
          grade,
          difficulty,
          template,
          mcqCount: mcq,
          subjectiveCount: subjective,
          evidenceSummary,
        }),
      });
      const payload = await res.json();
      logApiTiming(setState, payload?.timing);
      if (!res.ok) throw new Error(payload?.error || 'Worksheet generation failed');
      delete payload.timing;
      const nextContent = payload as WorksheetContent;

      const covered = new Set(
        [...nextContent.mcqQuestions, ...nextContent.subjectiveQuestions]
          .map((question) => question.concept?.trim().toLowerCase())
          .filter(Boolean),
      );
      const missing = topics.filter((topic) => !covered.has(topic.trim().toLowerCase()));
      if (missing.length)
        throw new Error(
          `Worksheet generation missed these learning gaps: ${missing.join(', ')}. Regenerate to cover every topic.`,
        );

      setProgress(100);
      setContent(nextContent);
      const resource: Worksheet = resourceFields(
        savedId ||
          `worksheet-${sourceAssessment?.id || Date.now()}-${sourceResult?.fileId || 'custom'}`,
        'Saved',
        nextContent,
      );
      setSavedId(resource.id);
      setState((state: DemoState) => ({
        ...state,
        resources: [resource, ...state.resources.filter((r) => r.id !== resource.id)],
        events: [`Worksheet saved · ${resource.title}`, ...state.events],
      }));
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Worksheet generation failed');
    } finally {
      clearInterval(progressTimer);
      setGenerating(false);
    }
  };

  // Reported, not swallowed: on a device every PDF entry point raises
  // `PdfUnavailableError`, and a bare `void` left a button that did nothing and
  // said nothing. The generated worksheet stays on screen either way.
  const reportDownload = (what: string) => (reason: unknown) =>
    setGenError(
      reason instanceof PdfUnavailableError
        ? `Downloading the ${what} is only available on the web build for now.`
        : `The ${what} could not be saved. Try again.`,
    );

  const questionCount = mcq + subjective;
  // The button's own gate, applied to Enter-to-submit as well: a count of zero
  // passes every field's validation, and would otherwise reach the server.
  const canGenerate =
    questionCount >= 1 && Boolean(title.trim() && subject.trim() && grade.trim()) && !generating;

  return (
    <Form onSubmit={() => (canGenerate ? generate() : undefined)}>
      <DialogHead
        eyebrow={
          presetStudent
            ? `${presetStudent} · Learning-gap resource studio`
            : 'Learning-gap resource studio'
        }
        title={worksheet ? 'Edit worksheet' : 'Create targeted worksheet'}
      />
      <Text style={s.modalCopy}>
        Balanced practice covers every identified topic:{' '}
        <Text style={{ fontWeight: FontWeight.bold }}>{topics.join(' · ')}</Text>.
      </Text>

      <View style={s.templatePicker} role="radiogroup" accessibilityLabel="Worksheet template">
        {TEMPLATES.map((option) => {
          const active = template === option.name;
          return (
            <Pressable
              key={option.name}
              role="radio"
              accessibilityState={{ checked: active }}
              accessibilityLabel={option.name}
              onPress={() => setTemplate(option.name)}
              style={[s.templateTrack, s.templateOption, active && s.templateOptionActive]}>
              <Text style={s.templateOptionTitle}>{option.name}</Text>
              <Text style={s.templateOptionCaption}>{option.caption}</Text>
            </Pressable>
          );
        })}
      </View>

      <Field label="Worksheet title" value={title} onChangeValue={setTitle} required />
      <FormGrid>
        <Field label="Subject" value={subject} onChangeValue={setSubject} required />
        <Field label="Class" value={grade} onChangeValue={setGrade} required />
        <Select
          label="Difficulty"
          options={DIFFICULTIES}
          value={difficulty}
          onValueChange={setDifficulty}
        />
        <Select label="Language" options={LANGUAGES} />
        <Field
          label="Multiple-choice questions"
          type="number"
          min={0}
          max={30}
          value={String(mcq)}
          onChangeValue={(text) => setMcq(toCount(text))}
        />
        <Field
          label="Subjective questions"
          type="number"
          min={0}
          max={20}
          value={String(subjective)}
          onChangeValue={(text) => setSubjective(toCount(text))}
        />
      </FormGrid>

      {questionCount < 1 ? (
        <View style={s.formError}>
          <Text style={s.formErrorText}>
            Add at least one multiple-choice or subjective question.
          </Text>
        </View>
      ) : null}

      <Checkbox label="Include worked example" defaultChecked />
      <Checkbox label="Include answer key and marking guide" defaultChecked />

      {generating ? (
        <>
          <Progress value={progress} />
          <Text style={s.modalCopy}>
            {`Worksheet generation continues on the server · ${progress}% · safe to switch tabs`}
          </Text>
        </>
      ) : null}

      <FormError>{genError}</FormError>

      {/* Above the preview rather than below it, as on the web: the preview's
          own action row belongs directly under the document it acts on, and
          the generate button belongs with the settings that feed it. */}
      <SubmitButton
        variant="secondary"
        title={
          generating
            ? 'Generating balanced worksheet…'
            : generated
              ? 'Regenerate and save worksheet'
              : 'Generate and save worksheet'
        }
        disabled={!canGenerate}
      />

      {content ? (
        <WorksheetPreview
          title={title}
          subject={subject}
          grade={grade}
          topics={topics}
          content={content}
          onDownloadWorksheet={() =>
            void downloadWorksheet(
              { title, template, concept: topics[0], concepts: topics, subject, grade, difficulty },
              content,
            ).catch(reportDownload('worksheet'))
          }
          onDownloadAnswerKey={() =>
            void downloadAnswerKey({ title, subject, grade, concepts: topics }, content).catch(
              reportDownload('answer key'),
            )
          }
          onApprove={save}
        />
      ) : null}
    </Form>
  );
}
