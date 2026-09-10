/**
 * `.resource-draft.branded-document` - the generated worksheet, on screen.
 *
 * Split out of `WorksheetDialog`
 * (frontend/app/ui/FunctionalEduAIApp.tsx:1420-1458): the dialog is a form with
 * a template picker, six settings and a generate call, and the preview is the
 * document that comes back. Neither half stays readable at four hundred lines
 * with the other attached, and the preview is the half a teacher actually
 * checks before approving, so it is the half worth reading on its own.
 *
 * Numbering is continuous across the two sections, as the web's single `<ol>`
 * was: the subjective questions carry on from the last multiple-choice one,
 * because that is how they are numbered on the printed sheet.
 *
 * `showModelAnswers` is the teacher's copy. It is off by default - a preview
 * shown to a class with the model answers on it is the answer key.
 */

import type { ReactNode } from 'react';
import { Text, View, type ViewStyle } from 'react-native';

import { BrandDocumentHeader } from '@/shared/components/brand';
import { AppButton, ButtonRow } from '@/shared/components/buttons';
import { Eyebrow } from '@/shared/components/primitives';
import { Space, useAppStyles } from '@/shared/theme/styles';
import type { WorksheetContent } from '@/shared/types/workspace';

export type WorksheetPreviewProps = {
  title: string;
  subject: string;
  grade: string;
  /** Every learning-gap topic the sheet has to cover, for the meta line. */
  topics: string[];
  content: WorksheetContent;
  /** The teacher's copy: each written question with the answer it expects. */
  showModelAnswers?: boolean;
  onDownloadWorksheet?: () => void;
  onDownloadAnswerKey?: () => void;
  onApprove?: () => void;
  /** Extra actions, appended to the row the three callbacks above build. */
  children?: ReactNode;
};

/** One numbered question. The badge is absolute, so the row indents around it. */
function QuestionItem({
  number,
  concept,
  question,
  children,
}: {
  number: number;
  concept?: string;
  question: string;
  children?: ReactNode;
}) {
  const s = useAppStyles();
  return (
    <View style={questionRow}>
      <View style={s.questionNumber}>
        <Text style={s.questionNumberText}>{number}</Text>
      </View>
      {concept ? (
        <View style={[s.status, conceptTag]}>
          <Text style={s.statusText}>{concept}</Text>
        </View>
      ) : null}
      <Text style={s.resourceDraftText}>{question}</Text>
      {children}
    </View>
  );
}

export function WorksheetPreview({
  title,
  subject,
  grade,
  topics,
  content,
  showModelAnswers,
  onDownloadWorksheet,
  onDownloadAnswerKey,
  onApprove,
  children,
}: WorksheetPreviewProps) {
  const s = useAppStyles();
  const mcq = content.mcqQuestions || [];
  const subjective = content.subjectiveQuestions || [];
  const hasActions = Boolean(onDownloadWorksheet || onDownloadAnswerKey || onApprove || children);

  return (
    <>
      <View style={[s.resourceDraft, s.brandedDocument]}>
        <BrandDocumentHeader
          label="Targeted practice worksheet"
          title={title}
          meta={`${subject} · ${grade} · ${topics.length} learning-gap topics`}
        />
        <Text style={s.resourceDraftText}>
          {`${mcq.length} multiple-choice · ${subjective.length} written response · answer key included`}
        </Text>

        {mcq.map((question, index) => (
          <QuestionItem
            key={`m${index}`}
            number={index + 1}
            concept={question.concept}
            question={question.question}>
            <Text style={s.guideLearningBody}>
              {question.options
                .map((option, j) => `${String.fromCharCode(65 + j)}) ${option}`)
                .join('   ')}
            </Text>
          </QuestionItem>
        ))}

        {subjective.map((question, index) => (
          <QuestionItem
            key={`s${index}`}
            number={mcq.length + index + 1}
            concept={question.concept}
            question={question.question}>
            {showModelAnswers ? (
              <View style={s.guideOverview}>
                <Eyebrow>Model answer</Eyebrow>
                <Text style={s.guideOverviewText}>{question.modelAnswer}</Text>
              </View>
            ) : null}
          </QuestionItem>
        ))}
      </View>

      {hasActions ? (
        <ButtonRow>
          {onDownloadWorksheet ? (
            <AppButton title="Download PDF worksheet" onPress={onDownloadWorksheet} />
          ) : null}
          {onDownloadAnswerKey ? (
            <AppButton title="Download PDF answer key" onPress={onDownloadAnswerKey} />
          ) : null}
          {onApprove ? (
            <AppButton variant="primary" title="Approve resource" onPress={onApprove} />
          ) : null}
          {children}
        </ButtonRow>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------------- *
 * `.resource-draft ol li` - the indent the absolute question number sits in.
 * ------------------------------------------------------------------------- */

const questionRow: ViewStyle = {
  position: 'relative',
  paddingLeft: Space.s42,
  paddingVertical: Space.s10,
  gap: Space.s6,
};

/** `.resource-draft .status` is an inline tag, not a full-width block. */
const conceptTag: ViewStyle = { alignSelf: 'flex-start' };
