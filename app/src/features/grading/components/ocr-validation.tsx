/**
 * `.ocr-validation` - the extracted text, per document, before anything is
 * analysed.
 *
 * Ported from the `{ocrDocuments && <section className="ocr-validation">…}`
 * block of frontend/app/ui/FunctionalEduAIApp.tsx `PerFileGradeDialogBody`
 * (~1360). Each role gets its own editor because a name misread on the answer
 * sheet and a mark misread on the marking scheme are different mistakes with
 * different fixes, and the grader is handed all four texts at once.
 *
 * ---------------------------------------------------------------------------
 * THE TEACHER GATE
 * ---------------------------------------------------------------------------
 * The panel's own pill has always said "Teacher validation required", and the
 * dialog copy above it promises that analysis will not start until the text is
 * validated. On the web that was a promise and nothing more: pressing the
 * action button a second time started the analysis whether or not anyone had
 * read a line. The confirmation below is what makes it true. It is deliberately
 * not skippable, and `useGradeRun` clears it on every edit - text that changed
 * after the confirmation has not been confirmed - so the last thing a teacher
 * does before analysis is always to look at the text that will be analysed.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTE
 * ---------------------------------------------------------------------------
 * The web sized each editor with `rows` - 12 for the answer sheet, 8 for the
 * references. React Native has no `rows`, and the ported stylesheet resolved
 * `.ocr-validation textarea` to one `minHeight`, so every editor is that height
 * and grows with its content instead.
 */

import { Text, TextInput, View } from 'react-native';

import { Eyebrow } from '@/shared/components/primitives';
import { Checkbox } from '@/shared/components/form';
import { StatusPill } from '@/shared/components/status';
import { useAppPalette, useAppStyles } from '@/shared/theme/styles';
import type { OcrDocumentRole, OcrDocuments } from '@/shared/types/workspace';

/**
 * The roles in the order the panel lists them, weakest evidence first: the
 * answer sheet is always present, the three references only when supplied.
 */
const ROLES: { id: OcrDocumentRole; label: string; fallbackName: string }[] = [
  { id: 'answerSheet', label: 'Student answer sheet', fallbackName: 'Answer sheet' },
  { id: 'questionPaper', label: 'Question paper', fallbackName: 'Question paper' },
  { id: 'markingScheme', label: 'Marking scheme', fallbackName: 'Marking scheme' },
  { id: 'modelAnswer', label: 'Model answer paper', fallbackName: 'Model answer paper' },
];

export type OcrValidationProps = {
  documents: OcrDocuments;
  onChange: (role: OcrDocumentRole, text: string) => void;
  /** The teacher's confirmation. Analysis is refused while this is false. */
  validated: boolean;
  onValidatedChange: (validated: boolean) => void;
  /** Locks the editors while a request is in flight. */
  disabled?: boolean;
};

export function OcrValidation({
  documents,
  onChange,
  validated,
  onValidatedChange,
  disabled,
}: OcrValidationProps) {
  const s = useAppStyles();
  const p = useAppPalette();

  return (
    <View style={s.ocrValidation}>
      <View style={s.ocrValidationHeader}>
        <View style={{ flexShrink: 1 }}>
          <Eyebrow>OCR validation</Eyebrow>
          <Text accessibilityRole="header" style={s.ocrValidationTitle}>
            Check the extracted text
          </Text>
        </View>
        <StatusPill tone={validated ? 'success' : 'warning'}>
          {validated ? 'Validated by teacher' : 'Teacher validation required'}
        </StatusPill>
      </View>

      <Text style={s.ocrValidationLead}>
        Correct names, question numbers, marks, formulas or unreadable words before continuing.
      </Text>

      {ROLES.map(({ id, label, fallbackName }) => {
        const document = documents[id];
        // The answer sheet is the subject of the run and is always offered,
        // even before its text has come back; the references appear only when
        // the teacher chose one.
        if (!document && id !== 'answerSheet') return null;
        const name = document?.name || fallbackName;
        return (
          <View key={id} style={s.label}>
            <Text style={s.ocrValidationLabel}>{`${label} · ${name}`}</Text>
            <TextInput
              multiline
              editable={!disabled}
              style={s.ocrValidationInput}
              value={document?.text || ''}
              onChangeText={(text) => onChange(id, text)}
              placeholderTextColor={p.muted}
              accessibilityLabel={`Extracted text for ${label}`}
            />
          </View>
        );
      })}

      <Checkbox
        label="I have checked and corrected the extracted text"
        checked={validated}
        onCheckedChange={onValidatedChange}
        disabled={disabled}
      />
    </View>
  );
}
