/**
 * Grade one answer sheet: upload -> OCR -> teacher validation -> AI analysis.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx `PerFileGradeDialog`
 * (~1190) and `PerFileGradeDialogBody` (~1195). This file is the markup only.
 * The run itself - candidate resolution, the two-phase OCR-then-grade request,
 * the evaluator submission and the bulk-queue advance - is `useGradeRun`, and
 * the two panels that appear mid-run are `OcrValidation` and
 * `EvaluatorWorkspace`. Nothing here reads a file or calls the API.
 *
 * The same body serves both registry entries. `grade-file` proposes marks that
 * land in the Review tab as unreviewed drafts; `diagnose-file` (`diagnosisOnly`)
 * is for a sheet the teacher already marked, whose awards are preserved and
 * only diagnosed. Neither path approves or publishes anything.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTE - the question-paper picker
 * ---------------------------------------------------------------------------
 * The web split this `<select>` into two `<optgroup>`s, "Assessment question
 * papers" and "Legacy uploaded evidence". `Select` has no option groups, so the
 * list keeps the same order - real question papers first - and every legacy
 * entry still carries its document role after the name, which is what told the
 * two groups apart on the web as well.
 */

import { Text, View } from 'react-native';

import { EvaluatorWorkspace } from '@/features/grading/components/evaluator-workspace';
import { OcrValidation } from '@/features/grading/components/ocr-validation';
import { useGradeRun } from '@/features/grading/hooks/use-grade-run';
import { inferDocumentRole } from '@/features/workspace/lib/documents';
import { AppButton } from '@/shared/components/buttons';
import { Field, FormGrid, Select, type SelectOption } from '@/shared/components/form';
import { DialogHead, Progress } from '@/shared/components/primitives';
import { useAppStyles } from '@/shared/theme/styles';
import type { UploadFile, W } from '@/shared/types/workspace';

export type PerFileGradeDialogBodyProps = W<
  'assessment' | 'state' | 'setState' | 'update' | 'open' | 'notify' | 'openAssessment' | 'close'
> & {
  file: UploadFile;
  /**
   * The sheet the teacher already marked: its awards are preserved and only
   * the learning gaps are diagnosed, so no grading review follows.
   */
  diagnosisOnly?: boolean;
};

/**
 * The `file` lookup at the call site can miss, so this wrapper owns the
 * not-found branch. The body must stay a separate component: `useGradeRun`
 * holds a dozen hooks, and returning early above them would change the hook
 * count between renders of the same instance.
 */
export function PerFileGradeDialog({
  file,
  ...rest
}: Omit<PerFileGradeDialogBodyProps, 'file'> & { file?: UploadFile }) {
  const s = useAppStyles();
  if (!file) {
    return (
      <>
        <DialogHead eyebrow={rest.assessment.title} title="Grade answer sheet" />
        <Text style={s.modalCopy}>
          This answer sheet could not be found. Close this dialog and try again.
        </Text>
      </>
    );
  }
  return <PerFileGradeDialogBody file={file} {...rest} />;
}

function PerFileGradeDialogBody(props: PerFileGradeDialogBodyProps) {
  const s = useAppStyles();
  const { assessment, file, diagnosisOnly = false } = props;
  const {
    questionPapers,
    markingSchemes,
    modelAnswers,
    otherQuestionPaperChoices,
    mappingOptions,
    availableSubjects,
    qpId,
    changeQuestionPaper,
    markingSchemeId,
    changeMarkingScheme,
    modelAnswerId,
    changeModelAnswer,
    studentName,
    setStudentName,
    analysisClassKey,
    chooseClass,
    analysisSubject,
    setAnalysisSubject,
    alreadyGraded,
    reanalysisReason,
    setReanalysisReason,
    progress,
    running,
    gradeError,
    ocrDocuments,
    updateOcr,
    ocrValidated,
    setOcrValidated,
    pendingAnalysis,
    updateQuestion,
    evaluationErrors,
    grade,
  } = useGradeRun(props);

  // One row per class: the mapping list repeats a class once for every subject.
  const classOptions: SelectOption[] = Array.from(
    new Map(mappingOptions.map((option) => [option.classKey, option])).values(),
  ).map((option) => ({ label: `Class ${option.grade}${option.section}`, value: option.classKey }));

  const questionPaperOptions: SelectOption[] = [
    ...questionPapers.map((f) => ({ label: f.name, value: f.id })),
    ...otherQuestionPaperChoices.map((f) => ({
      label: `${f.name} · ${f.documentRole || inferDocumentRole(f.name)}`,
      value: f.id,
    })),
  ];

  const title = diagnosisOnly
    ? 'Analyse teacher-graded answer sheet'
    : alreadyGraded
      ? 'Regrade answer sheet'
      : 'Grade answer sheet';

  // The web's caption said "awaiting teacher validation" for as long as OCR
  // text existed. Validation is now a real step, so the caption follows it
  // instead of contradicting the pill in the panel above.
  const progressCaption = running
    ? ocrDocuments
      ? `Diagnostic analysis: ${progress}%`
      : `Mistral OCR: ${progress}%`
    : ocrDocuments
      ? ocrValidated
        ? 'OCR complete · validated by teacher'
        : 'OCR complete · awaiting teacher validation'
      : 'Ready';

  const actionTitle = running
    ? ocrDocuments
      ? 'Generating reports in the background…'
      : 'Extracting text with Mistral…'
    : ocrDocuments
      ? diagnosisOnly
        ? 'Analyse Teacher Marks & Generate All Reports'
        : 'Generate All Reports'
      : 'Extract OCR text with Mistral';

  return (
    <>
      <DialogHead eyebrow={assessment.title} title={title} />
      <Text style={s.modalCopy}>
        {diagnosisOnly
          ? "First extract and validate the teacher's awarded marks and comments. The system will preserve those marks, diagnose learning gaps, and generate all further reports without a grading review."
          : 'First extract text with Mistral. Review and correct it on screen. Learning-gap analysis will not start until you validate the OCR text.'}
      </Text>

      {/* No `required` on these controls: there is no <Form> to enforce it.
          `grade()` checks each one and says which is missing. */}
      <Field label="Answer sheet" value={file.name} editable={false} />
      <Field label="Student name" value={studentName} onChangeValue={setStudentName} />

      <FormGrid>
        <Select
          label="Class & section"
          placeholder="Select class & section"
          options={classOptions}
          value={analysisClassKey}
          // The web's placeholder option was `disabled`; picking it here must
          // not clear a class that was already chosen.
          onValueChange={(next) => {
            if (next) chooseClass(next);
          }}
        />
        <Select
          label="Subject"
          placeholder="Select subject"
          options={availableSubjects}
          value={analysisSubject}
          disabled={!availableSubjects.length}
          onValueChange={(next) => {
            if (next) setAnalysisSubject(next);
          }}
        />
      </FormGrid>

      {alreadyGraded ? (
        <Field
          label="Reason for Reanalysis"
          type="textarea"
          value={reanalysisReason}
          onChangeValue={setReanalysisReason}
          placeholder="Explain what the previous analysis missed or should reconsider."
        />
      ) : null}

      <Select
        label="Question paper · required"
        placeholder="Select the assessment question paper"
        options={questionPaperOptions}
        value={qpId}
        onValueChange={changeQuestionPaper}
      />

      <FormGrid>
        <Select
          label="Marking scheme"
          placeholder="Not supplied"
          options={markingSchemes.map((f) => ({ label: f.name, value: f.id }))}
          value={markingSchemeId}
          onValueChange={changeMarkingScheme}
        />
        <Select
          label="Model answer paper"
          placeholder="Not supplied"
          options={modelAnswers.map((f) => ({ label: f.name, value: f.id }))}
          value={modelAnswerId}
          onValueChange={changeModelAnswer}
        />
      </FormGrid>

      {!questionPapers.length ? (
        <View style={s.formError}>
          <Text style={s.formErrorText}>
            This legacy assessment has no question paper. Edit or recreate the assessment with the
            compulsory question paper before analysis.
          </Text>
        </View>
      ) : null}

      {ocrDocuments ? (
        <OcrValidation
          documents={ocrDocuments}
          onChange={updateOcr}
          validated={ocrValidated}
          onValidatedChange={setOcrValidated}
          disabled={running}
        />
      ) : null}

      {progress > 0 ? (
        <>
          <Progress value={progress} />
          <Text style={s.modalCopy}>{progressCaption}</Text>
        </>
      ) : null}

      {pendingAnalysis ? (
        <EvaluatorWorkspace
          questions={pendingAnalysis.questions}
          maxMarks={pendingAnalysis.result.maxMarks}
          errors={evaluationErrors}
          onChange={updateQuestion}
        />
      ) : null}

      {gradeError ? (
        <View role="alert" style={s.formError}>
          <Text style={s.formErrorText}>{gradeError}</Text>
        </View>
      ) : null}

      <AppButton
        variant="primary"
        full
        title={actionTitle}
        disabled={running}
        onPress={() => void grade()}
      />
    </>
  );
}
