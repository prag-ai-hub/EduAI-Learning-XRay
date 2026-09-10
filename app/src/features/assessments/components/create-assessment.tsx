/**
 * "Create or generate assessment" - the form.
 *
 * Ported from `CreateAssessment` (frontend/app/ui/FunctionalEduAIApp.tsx:945).
 * Only the *shell* is here. Everything the button sets off - the upload/generate
 * branch, the POST to /api/generate-assessment, the three `createBrandedPdfBlob`
 * renders, the size and format guards, the file fan-out and the workspace write
 * - already lives in `@/features/assessments/hooks/use-create-assessment`. This
 * component collects fields and hands them over; it must not grow a second copy
 * of that pipeline.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTES
 * ---------------------------------------------------------------------------
 *  * **The eight `<Field>` wrappers.** The source's `Field` was a `<label>`
 *    around a child control; `form.tsx`'s `Field` renders its own TextInput and
 *    takes no children. So `<Field><select/></Field>` became `Select`,
 *    `<Field><input/></Field>` became `Field` with a `type`, and the four
 *    `<Field><input type="file"/></Field>` became labelled `FilePickerButton`s.
 *  * **The picked documents are component state, not form fields.** A
 *    `FilePickerButton` does not register with `Form`, and the hook already
 *    owns the "a question paper is required" rule and reports it through the
 *    same error slot as everything else - so validating it twice, in two
 *    different vocabularies, would only give the teacher two chances to read
 *    two different sentences about one missing file.
 *  * **`new Date()` cannot run during render.** The date default is fixed once,
 *    in a lazy initialiser, which is what an uncontrolled default wants anyway.
 */

import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import {
  useCreateAssessment,
  type AssessmentSourceMode,
  type PickedDocument,
} from '@/features/assessments/hooks/use-create-assessment';
import { DOCUMENT_ACCEPT } from '@/features/workspace/lib/demo-state';
import { FilePickerButton, type PickedFile } from '@/shared/components/file-picker';
import {
  Field,
  Form,
  FormError,
  FormGrid,
  Select,
  SubmitButton,
} from '@/shared/components/form';
import { DialogHead } from '@/shared/components/primitives';
import { useAppStyles } from '@/shared/theme/styles';
import type { W } from '@/shared/types/workspace';

const ACTIVITY_TYPES = [
  'Test',
  'Quiz',
  'Worksheet',
  'Homework',
  'Assessment',
  'Diagnostic',
  'Follow-up',
];

const CLASSES = Array.from({ length: 12 }, (_, index) => String(index + 1));

const GRADING_MODES = ['Structured', 'Objective', 'Rubric', 'Completion'];

const SOURCE_OPTIONS: { mode: AssessmentSourceMode; title: string; caption: string }[] = [
  {
    mode: 'upload',
    title: 'Upload question paper',
    caption: 'Use an existing paper and optional marking references',
  },
  {
    mode: 'generate',
    title: 'Generate assessment',
    caption: 'Create a paper, marking scheme and model answer with AI',
  },
];

/**
 * `PickedFile` and `PickedDocument` are structurally identical and deliberately
 * kept apart - `shared/` may not import `features/`. Converting explicitly is
 * cheaper than assuming they stay assignable.
 */
function asDocument(file: PickedFile): PickedDocument {
  return { name: file.name, type: file.type, size: file.size, source: file.source };
}

/** One arm of `.assessment-source-picker` - a radio drawn as a card. */
function SourceOption({
  title,
  caption,
  active,
  onPress,
}: {
  title: string;
  caption: string;
  active: boolean;
  onPress: () => void;
}) {
  const s = useAppStyles();
  return (
    <View style={s.assessmentSourceTrack}>
      <Pressable
        role="radio"
        accessibilityLabel={`${title}. ${caption}`}
        accessibilityState={{ checked: active }}
        onPress={onPress}
        style={[s.assessmentSourceOption, active && s.assessmentSourceOptionActive]}>
        <Text style={s.assessmentSourceTitle}>{title}</Text>
        <Text style={s.assessmentSourceCaption}>{caption}</Text>
      </Pressable>
    </View>
  );
}

export function CreateAssessment({
  setState,
  done,
}: W<'setState'> & { done: (id: string) => void }) {
  const s = useAppStyles();
  const [sourceMode, setSourceMode] = useState<AssessmentSourceMode>('upload');
  const [questionPaper, setQuestionPaper] = useState<PickedDocument>();
  const [markingScheme, setMarkingScheme] = useState<PickedDocument>();
  const [modelAnswer, setModelAnswer] = useState<PickedDocument>();
  const [blueprint, setBlueprint] = useState<PickedDocument>();
  const [today] = useState(() => new Date().toISOString().slice(0, 10));

  const { submit, saving, error } = useCreateAssessment({ setState, done });

  const generating = sourceMode === 'generate';

  return (
    <Form
      onSubmit={(values) =>
        submit({
          title: values.get('title'),
          type: values.get('type'),
          className: values.get('className'),
          section: values.get('section'),
          subject: values.get('subject'),
          maxMarks: values.number('marks'),
          date: values.get('date'),
          sourceMode,
          questionPaper,
          markingScheme,
          modelAnswer,
          blueprint,
        })
      }>
      <DialogHead eyebrow="New work" title="Create or generate assessment" />

      <FormGrid>
        <Field
          name="title"
          label="Title"
          required
          minLength={3}
          placeholder="e.g. Fractions checkpoint"
        />
        <Select name="type" label="Activity type" required options={ACTIVITY_TYPES} />
        <Select name="className" label="Class" options={CLASSES} />
        <Field name="section" label="Section" required defaultValue="A" />
        <Field name="subject" label="Subject" required defaultValue="Mathematics" />
        <Field
          name="marks"
          label="Maximum marks"
          type="number"
          min={1}
          max={200}
          required
          defaultValue="20"
        />
        <Field name="date" label="Assessment date" type="date" required defaultValue={today} />
        {/* Unnamed in the source, so nothing reads it back. Left unnamed. */}
        <Select label="Grading mode" options={GRADING_MODES} />
      </FormGrid>

      <View
        style={s.assessmentSourcePicker}
        role="radiogroup"
        accessibilityLabel="Question paper source">
        {SOURCE_OPTIONS.map((option) => (
          <SourceOption
            key={option.mode}
            title={option.title}
            caption={option.caption}
            active={sourceMode === option.mode}
            onPress={() => setSourceMode(option.mode)}
          />
        ))}
      </View>

      <View>
        <Text style={s.eyebrow}>
          {generating ? 'AI assessment generation' : 'Assessment reference documents'}
        </Text>
        {generating ? (
          <>
            <Text style={s.modalCopy}>
              A blueprint is optional. When supplied, its structure, sections and mark distribution
              guide the generated assessment.
            </Text>
            <FilePickerButton
              label="Assessment blueprint · optional"
              accept={DOCUMENT_ACCEPT}
              onPicked={(picked) => setBlueprint(picked[0] ? asDocument(picked[0]) : undefined)}
            />
            <View style={s.insight}>
              <Text style={s.insightText}>
                EduAI will generate the compulsory question paper together with its marking scheme
                and complete model answer. You can review the generated documents before analysing
                student work.
              </Text>
            </View>
          </>
        ) : (
          <>
            <Text style={s.modalCopy}>
              The uploaded files are fixed to the assessment and automatically used during OCR and
              learning-gap analysis.
            </Text>
            <FilePickerButton
              label="Question paper · required"
              accept={DOCUMENT_ACCEPT}
              onPicked={(picked) =>
                setQuestionPaper(picked[0] ? asDocument(picked[0]) : undefined)
              }
            />
            <FormGrid>
              <FilePickerButton
                label="Marking scheme"
                accept={DOCUMENT_ACCEPT}
                onPicked={(picked) =>
                  setMarkingScheme(picked[0] ? asDocument(picked[0]) : undefined)
                }
              />
              <FilePickerButton
                label="Model answer paper"
                accept={DOCUMENT_ACCEPT}
                onPicked={(picked) => setModelAnswer(picked[0] ? asDocument(picked[0]) : undefined)}
              />
            </FormGrid>
          </>
        )}
      </View>

      <FormError>{error}</FormError>
      <SubmitButton
        disabled={saving}
        title={
          saving
            ? generating
              ? 'Generating assessment & references…'
              : 'Saving assessment & documents…'
            : generating
              ? 'Generate & save assessment'
              : 'Save uploaded assessment'
        }
      />
    </Form>
  );
}
