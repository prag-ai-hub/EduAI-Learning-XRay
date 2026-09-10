/**
 * The two "which answer sheet?" pickers.
 *
 * Ported from `GradeSelectionDialog` (frontend/app/ui/FunctionalEduAIApp.tsx:1003)
 * and `DiagnosisSelectionDialog` (:1004). Both list every file on the
 * assessment, allow only the answer sheets to be chosen, and refuse to continue
 * until a question paper is attached - the reference documents are shown rather
 * than hidden so a teacher can see *why* a file is not selectable.
 *
 * The difference between them is the destination. Grade selection reads the
 * document role and routes a teacher-marked sheet to diagnosis instead of
 * grading, because those marks are the teacher's and must not be overwritten.
 * Diagnosis selection always goes to diagnosis - it is the "skip grading" door.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTE - the radio
 * ---------------------------------------------------------------------------
 * `.grade-file-picker label` is a four-column grid whose first 20px column is a
 * real `<input type="radio">`, so the browser drew the dial and the CSS never
 * described it. React Native has no radio control, so the dial is built here
 * from palette steps, exactly as `form.tsx`'s `Checkbox` builds its box. The
 * selected row still takes the orange `.selected` treatment from the stylesheet;
 * only the glyph that the browser supplied is new.
 */

import { useState } from 'react';
import { Pressable, Text, View, type ViewStyle } from 'react-native';

import {
  analysisDialogFor,
  inferDocumentRole,
  isAnswerSheetFile,
  isQuestionPaperFile,
} from '@/features/workspace/lib/documents';
import { AppButton } from '@/shared/components/buttons';
import { DialogHead } from '@/shared/components/primitives';
import { Radius, Space, useAppPalette, useAppStyles } from '@/shared/theme/styles';
import type { UploadFile, W } from '@/shared/types/workspace';

/** The `.file-icon` glyph: the extension, upper-cased, as the web read it off the name. */
function extensionOf(name: string): string {
  return name.split('.').pop()?.toUpperCase() || 'FILE';
}

/** The 20px first grid column the browser filled with a radio dial. */
const radioOuter: ViewStyle = {
  width: Space.s18,
  height: Space.s18,
  borderWidth: 1,
  borderRadius: Radius.circle(Space.s18),
  alignItems: 'center',
  justifyContent: 'center',
};

const radioInner: ViewStyle = {
  width: Space.s8,
  height: Space.s8,
  borderRadius: Radius.circle(Space.s8),
};

function FileOption({
  file,
  caption,
  selected,
  disabled,
  flag,
  onSelect,
}: {
  file: UploadFile;
  caption: string;
  selected: boolean;
  /** A reference document: listed, explained, but not choosable. */
  disabled: boolean;
  /** `<em>Already analysed</em>` - green, and only on the grading picker. */
  flag?: string;
  onSelect: () => void;
}) {
  const s = useAppStyles();
  const p = useAppPalette();
  return (
    <Pressable
      role="radio"
      accessibilityLabel={`${file.name}. ${caption}${flag ? `. ${flag}` : ''}`}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onSelect}
      style={[s.gradeFileOption, selected && s.gradeFileOptionSelected, disabled && s.disabled]}>
      <View style={[radioOuter, { borderColor: selected ? p.navy : p.border }]}>
        {selected ? <View style={[radioInner, { backgroundColor: p.navy }]} /> : null}
      </View>
      <View style={s.fileIcon}>
        <Text style={s.fileIconText}>{extensionOf(file.name)}</Text>
      </View>
      <View style={{ flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
        <Text style={s.gradeFileTitle} numberOfLines={2}>
          {file.name}
        </Text>
        <Text style={s.gradeFileCaption}>{caption}</Text>
      </View>
      {flag ? <Text style={s.gradeFileFlag}>{flag}</Text> : null}
    </Pressable>
  );
}

/** `<p className="form-error">` outside a form - a blocking condition, not a field error. */
function Blocker({ children }: { children: string }) {
  const s = useAppStyles();
  return (
    <View role="alert" style={s.formError}>
      <Text style={s.formErrorText}>{children}</Text>
    </View>
  );
}

/**
 * Choose the sheet to run the full analysis on.
 *
 * The button's wording and its destination both follow the chosen file's role,
 * so the teacher reads what is about to happen before it happens.
 */
export function GradeSelectionDialog({ assessment, open }: W<'assessment' | 'open'>) {
  const s = useAppStyles();
  const allFiles: UploadFile[] = assessment.files || [];
  const answerCandidates = allFiles.filter((file) => isAnswerSheetFile(file, allFiles.length));
  const hasQuestionPaper = allFiles.some((file) => isQuestionPaperFile(file, allFiles.length));
  const [selectedFileId, setSelectedFileId] = useState(answerCandidates[0]?.id || '');
  const selected = answerCandidates.find((file) => file.id === selectedFileId);
  const teacherGraded = selected?.documentRole === 'Teacher-graded answer sheet';

  return (
    <>
      <DialogHead eyebrow={assessment.title} title="Select answer sheet for analysis" />
      <Text style={s.modalCopy}>
        Ungraded sheets continue through AI grading and teacher review. Teacher-graded sheets
        preserve the teacher&apos;s marks and go directly to learning-gap diagnosis and report
        generation.
      </Text>
      <View style={s.gradeFilePicker} role="radiogroup" accessibilityLabel="Answer sheet">
        {allFiles.map((file) => {
          const answer = isAnswerSheetFile(file, allFiles.length);
          const role = file.documentRole || inferDocumentRole(file.name);
          return (
            <FileOption
              key={file.id}
              file={file}
              caption={answer ? role : `${role} · assessment reference`}
              selected={selectedFileId === file.id}
              disabled={!answer}
              flag={assessment.gradeResults?.[file.id] ? 'Already analysed' : undefined}
              onSelect={() => setSelectedFileId(file.id)}
            />
          );
        })}
      </View>
      {teacherGraded ? (
        <View style={s.insight}>
          <Text style={s.insightText}>
            Teacher-graded selected: OCR will read the awarded marks and comments, then generate
            learning gaps and all reports without opening the grading review.
          </Text>
        </View>
      ) : null}
      {!hasQuestionPaper ? (
        <Blocker>
          A question paper is compulsory. This assessment cannot be analysed until one is attached
          in assessment creation.
        </Blocker>
      ) : null}
      {!answerCandidates.length ? (
        <Blocker>Upload at least one student answer sheet.</Blocker>
      ) : null}
      <AppButton
        variant="primary"
        full
        disabled={!selectedFileId || !hasQuestionPaper}
        title={
          teacherGraded
            ? 'Read teacher marks & diagnose learning gaps →'
            : 'Continue to grading & teacher review →'
        }
        onPress={() => selected && open(`${analysisDialogFor(selected)}:${selectedFileId}`)}
      />
    </>
  );
}

/**
 * Choose the sheet to diagnose without grading it.
 *
 * The caption on a selectable row is the flat "Answer sheet" rather than the
 * document role: this door does not care whether the sheet was marked, so
 * naming the role would suggest a branch that is not there.
 */
export function DiagnosisSelectionDialog({ assessment, open }: W<'assessment' | 'open'>) {
  const s = useAppStyles();
  const allFiles: UploadFile[] = assessment.files || [];
  const answerCandidates = allFiles.filter((file) => isAnswerSheetFile(file, allFiles.length));
  const hasQuestionPaper = allFiles.some((file) => isQuestionPaperFile(file, allFiles.length));
  const [selectedFileId, setSelectedFileId] = useState(answerCandidates[0]?.id || '');

  return (
    <>
      <DialogHead
        eyebrow={assessment.title}
        title="Select answer sheet for learning-gap diagnosis"
      />
      <Text style={s.modalCopy}>
        Choose an answer sheet to use the existing Learning Gap Diagnosis without completing
        grading.
      </Text>
      <View style={s.gradeFilePicker} role="radiogroup" accessibilityLabel="Answer sheet">
        {allFiles.map((file) => {
          const answer = isAnswerSheetFile(file, allFiles.length);
          return (
            <FileOption
              key={file.id}
              file={file}
              caption={
                answer
                  ? 'Answer sheet'
                  : `${file.documentRole || inferDocumentRole(file.name)} · assessment reference`
              }
              selected={selectedFileId === file.id}
              disabled={!answer}
              onSelect={() => setSelectedFileId(file.id)}
            />
          );
        })}
      </View>
      {!hasQuestionPaper ? (
        <Blocker>A question paper is compulsory for the existing Learning Gap Diagnosis.</Blocker>
      ) : null}
      {!answerCandidates.length ? (
        <Blocker>Upload at least one student answer sheet.</Blocker>
      ) : null}
      <AppButton
        variant="primary"
        full
        disabled={!selectedFileId || !hasQuestionPaper}
        title="Skip Grading & Diagnose Learning Gaps →"
        onPress={() => open(`diagnose-file:${selectedFileId}`)}
      />
    </>
  );
}
