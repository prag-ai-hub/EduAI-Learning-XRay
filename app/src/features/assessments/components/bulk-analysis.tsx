/**
 * "Check Multiple Students" - the five-step wizard that queues one assessment's
 * answer sheets for analysis, one after another.
 *
 * Ported from `BulkAnalysisWizard` (frontend/app/ui/FunctionalEduAIApp.tsx:1016).
 * The wizard does not analyse anything itself: it writes the work queue, then
 * hands over to the per-file grading dialog, which advances the queue and comes
 * back. That indirection is what stops a teacher double-charging credits by
 * opening two sheets at once, and it is why the queue lives in
 * `@/features/assessments/lib/bulk-queue` rather than in this component's state.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTE - the queue is asynchronous, and it now outlives the tab
 * ---------------------------------------------------------------------------
 * The web read `sessionStorage` synchronously. There is no synchronous
 * key/value store on a device, so every `bulk-queue` call is a promise and has
 * to be awaited - including the one that starts the run, which must be on disk
 * before the first grading dialog opens or that dialog will not know it is part
 * of a run.
 *
 * The store behind it is `appStore`, which survives a reload where
 * `sessionStorage` did not. So an interrupted run is still there when the
 * wizard is reopened, and the wizard opens on the progress step rather than
 * asking the teacher to reselect students they have already chosen. The
 * selection is reconstructed as "still queued" plus "already has a result",
 * which is exactly the set the run was started with.
 */

import { useEffect, useState } from 'react';
import { Pressable, Text, View, type ViewStyle } from 'react-native';

import { bulkAnalysisQueue, saveBulkAnalysisQueue } from '@/features/assessments/lib/bulk-queue';
import { guessStudentName } from '@/features/workspace/lib/demo-state';
import { analysisDialogFor, isAnswerSheetFile } from '@/features/workspace/lib/documents';
import { AppButton, ButtonRow } from '@/shared/components/buttons';
import { Checkbox } from '@/shared/components/form';
import { DialogHead, Progress } from '@/shared/components/primitives';
import { StatusPill } from '@/shared/components/status';
import { Radius, Space, useAppPalette, useAppStyles } from '@/shared/theme/styles';
import type { DoneWithMessage, UploadFile, W } from '@/shared/types/workspace';

/** `.impact-box` - the two-line summary panel the wizard opens and closes with. */
function ImpactBox({ title, caption }: { title: string; caption: string }) {
  const s = useAppStyles();
  return (
    <View style={s.impactBox}>
      <Text style={s.impactBoxTitle}>{title}</Text>
      <Text style={s.impactBoxCaption}>{caption}</Text>
    </View>
  );
}

export function BulkAnalysisWizard({
  assessment,
  open,
  done,
}: W<'assessment' | 'open'> & { done: DoneWithMessage }) {
  const s = useAppStyles();
  const allFiles: UploadFile[] = assessment.files || [];
  const answers = allFiles.filter((file) => isAnswerSheetFile(file, allFiles.length));

  const [step, setStep] = useState(1);
  const [selected, setSelected] = useState<string[]>(answers.map((file) => file.id));

  const chosen = answers.filter((file) => selected.includes(file.id));
  const completed = chosen.filter((file) => assessment.gradeResults?.[file.id]);
  const pending = chosen.filter((file) => !assessment.gradeResults?.[file.id]);
  const nextPending = pending[0];

  // Pick a stored run back up. Deliberately keyed on the assessment alone: if
  // it re-ran whenever a result landed it would drag the teacher back to step 4
  // every time they finished a sheet, which is the one moment they are not
  // looking at this dialog.
  useEffect(() => {
    let alive = true;
    void bulkAnalysisQueue(assessment.id).then((queue) => {
      if (!alive || !queue.length) return;
      // The queue, and only the queue. It holds what this run has left to do,
      // which is the one thing the stored state actually evidences.
      //
      // Unioning it with every graded sheet on the assessment was wrong twice
      // over: a sheet the teacher deliberately deselected came back, and so did
      // sheets graded in an entirely earlier run - so the resumed run reported
      // itself larger than it was. Nothing records which graded sheets belonged
      // to THIS run, so including any of them is a guess, and a guess that
      // silently re-adds work the teacher removed is the worse failure.
      setSelected(answers.filter((file) => queue.includes(file.id)).map((file) => file.id));
      setStep(4);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assessment.id]);

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );

  /**
   * Write the queue, then open the first sheet. The await matters: the grading
   * dialog reads the queue on mount to decide whether it was opened as part of
   * a run, and a queue still in flight would read as an empty one.
   */
  const startQueue = async () => {
    await saveBulkAnalysisQueue(
      assessment.id,
      pending.map((file) => file.id),
    );
    if (nextPending) open(`${analysisDialogFor(nextPending)}:${nextPending.id}`);
    else setStep(5);
  };

  return (
    <>
      <DialogHead
        eyebrow={`Step ${step} of 5 · ${assessment.title}`}
        title="Check Multiple Students"
      />

      {step === 1 ? (
        <>
          <Text style={s.modalCopy}>
            Select the students whose uploaded answer sheets belong to this assessment.
          </Text>
          {/* `Checkbox` with no `name`: it is a control, not a submitted field,
              and this dialog has no <Form> for it to register with. */}
          <Checkbox
            label="Select All"
            checked={selected.length === answers.length && answers.length > 0}
            onCheckedChange={(all) => setSelected(all ? answers.map((file) => file.id) : [])}
          />
          <View style={s.gradeFilePicker}>
            {answers.map((file) => (
              <SheetRow
                key={file.id}
                file={file}
                selected={selected.includes(file.id)}
                flag={assessment.gradeResults?.[file.id] ? 'Completed' : 'Uploaded'}
                onToggle={() => toggle(file.id)}
              />
            ))}
          </View>
          <AppButton
            variant="primary"
            full
            disabled={!selected.length}
            title={`Continue with ${selected.length} student${selected.length === 1 ? '' : 's'}`}
            onPress={() => setStep(2)}
          />
        </>
      ) : null}

      {step === 2 ? (
        <>
          <Text style={s.modalCopy}>
            Confirm each student-to-answer-sheet match. Use Upload evidence if a selected student
            has no sheet.
          </Text>
          <View style={s.uploadList}>
            {chosen.map((file) => (
              <View key={file.id} style={s.uploadRow}>
                <View style={s.fileIcon}>
                  <Text style={s.fileIconText}>PDF</Text>
                </View>
                <View style={s.uploadRowBody}>
                  <Text style={s.uploadRowTitle}>{guessStudentName(file, [])}</Text>
                  <Text style={s.uploadRowCaption}>
                    {file.name} · {file.status || 'Uploaded'}
                  </Text>
                </View>
                <StatusPill tone="success">Ready</StatusPill>
              </View>
            ))}
          </View>
          <ButtonRow>
            <AppButton title="Upload / replace sheets" onPress={() => open('upload')} />
            <AppButton title="Confirm matches" variant="primary" onPress={() => setStep(3)} />
          </ButtonRow>
        </>
      ) : null}

      {step === 3 ? (
        <>
          <ImpactBox
            title={`Students selected: ${chosen.length}`}
            caption={`Answer sheets ready: ${chosen.length}`}
          />
          <Text style={s.modalCopy}>
            Each sheet uses the same assessment question paper and marking references. Teacher OCR
            validation remains required before AI analysis. After each worksheet is saved, the queue
            automatically opens the next selected student.
          </Text>
          <AppButton
            variant="primary"
            full
            title="Start Analysis"
            onPress={() => void startQueue()}
          />
        </>
      ) : null}

      {step === 4 ? (
        <>
          <Progress
            value={chosen.length ? Math.round((completed.length / chosen.length) * 100) : 0}
          />
          <Text style={s.modalCopy}>
            Processing {completed.length} of {chosen.length}. The safe queue prevents duplicate
            requests and credit charges.
          </Text>
          <View style={s.pipeline}>
            {chosen.map((file) => {
              const graded = Boolean(assessment.gradeResults?.[file.id]);
              return (
                <View key={file.id} style={s.pipelineRow}>
                  <View style={[s.pipelineIcon, graded && s.pipelineIconDone]}>
                    <Text style={graded ? s.pipelineIconDoneText : s.pipelineCaption}>
                      {graded ? '✓' : '…'}
                    </Text>
                  </View>
                  <Text style={[s.pipelineTitle, { flexGrow: 1, flexShrink: 1 }]} numberOfLines={1}>
                    {guessStudentName(file, [])}
                  </Text>
                  <Text style={s.pipelineCaption}>
                    {graded
                      ? 'Completed'
                      : file.id === nextPending?.id
                        ? 'Ready for teacher validation'
                        : 'Pending'}
                  </Text>
                </View>
              );
            })}
          </View>
          {nextPending ? (
            <AppButton
              variant="primary"
              full
              title="Validate OCR & analyse next student"
              onPress={() => open(`grade-file:${nextPending.id}`)}
            />
          ) : (
            <AppButton
              variant="primary"
              full
              title="View completion summary"
              onPress={() => setStep(5)}
            />
          )}
        </>
      ) : null}

      {step === 5 ? (
        <>
          <ImpactBox
            title={`${chosen.length} Students Selected`}
            caption={`${completed.length} Successfully Completed · ${
              chosen.length - completed.length
            } Failed or Pending`}
          />
          <ButtonRow>
            <AppButton title="Retry Failed" onPress={() => setStep(4)} />
            <AppButton title="View Results" onPress={() => open('process')} />
            <AppButton
              title="Download Reports"
              variant="primary"
              onPress={() => done('Multiple-student analysis queue completed')}
            />
          </ButtonRow>
        </>
      ) : null}
    </>
  );
}

/** The 20px first grid column of `.grade-file-picker`, which was a real checkbox. */
const tickBox: ViewStyle = {
  width: Space.s18,
  height: Space.s18,
  borderWidth: 1,
  borderRadius: Radius.sm,
  alignItems: 'center',
  justifyContent: 'center',
};

/**
 * One selectable sheet on step 1. It reuses `.grade-file-picker`'s row exactly
 * as the source did, so the multi-select step and the single-select pickers in
 * `grade-selection.tsx` look like the same control - which is the point: the
 * teacher is choosing from the same list either way. Only the tick itself is
 * new, because the browser drew it and the stylesheet never described it.
 */
function SheetRow({
  file,
  selected,
  flag,
  onToggle,
}: {
  file: UploadFile;
  selected: boolean;
  flag: string;
  onToggle: () => void;
}) {
  const s = useAppStyles();
  const p = useAppPalette();
  const student = guessStudentName(file, []);
  return (
    <Pressable
      role="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${student}. ${file.name}. ${flag}`}
      onPress={onToggle}
      style={[s.gradeFileOption, selected && s.gradeFileOptionSelected]}>
      <View
        style={[
          tickBox,
          { borderColor: selected ? p.navy : p.border, backgroundColor: selected ? p.navy : p.field },
        ]}>
        {selected ? <Text style={[s.checkText, { color: p.onNavy }]}>✓</Text> : null}
      </View>
      <View style={s.fileIcon}>
        <Text style={s.fileIconText}>{file.name.split('.').pop()?.toUpperCase() || 'FILE'}</Text>
      </View>
      <View style={{ flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
        <Text style={s.gradeFileTitle}>{student}</Text>
        <Text style={s.gradeFileCaption} numberOfLines={2}>
          {file.name}
        </Text>
      </View>
      <Text style={s.gradeFileFlag}>{flag}</Text>
    </Pressable>
  );
}
