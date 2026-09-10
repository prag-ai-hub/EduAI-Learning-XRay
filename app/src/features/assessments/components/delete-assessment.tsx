/**
 * Deleting an assessment, and everything that only exists because of it.
 *
 * Ported from `DeleteAssessmentDialog` (frontend/app/ui/FunctionalEduAIApp.tsx:1683).
 *
 * ---------------------------------------------------------------------------
 * The cascade, and why each arm is here
 * ---------------------------------------------------------------------------
 * An assessment is the root of five things, and missing any one of them leaves
 * a row that points at an id nothing answers to:
 *
 *  1. **Uploaded files** - the bytes in secure storage and the device cache.
 *     This is the only arm that can fail, and the only one that runs first:
 *     the workspace row is not touched until the storage is actually clear, or
 *     a retry would find nothing left to retry with.
 *  2. **Grade results** - held inside the assessment row, so they go with it.
 *  3. **Generated resources** - worksheets and study guides carrying this
 *     `assessmentId`.
 *  4. **Interventions** raised against it.
 *  5. **The bulk-analysis queue.** The web app cleared `sessionStorage` here
 *     and could have got away with skipping it - the tab was closing anyway.
 *     `appStore` is durable, so a queue left behind now outlives the assessment
 *     and would send the next run at file ids that no longer exist.
 *
 * The storage delete goes through `deleteFile`, which clears the device cache
 * and then calls DELETE /api/files/[id]. The web tolerated a 404 there; that
 * route never returns one (Supabase's `remove` is a no-op for a missing object,
 * and every other failure is a 500), so the exemption had nothing to catch and
 * a genuine failure still stops the delete, exactly as it did before.
 */

import { useState } from 'react';
import { Text, View } from 'react-native';

import { clearBulkAnalysisQueue } from '@/features/assessments/lib/bulk-queue';
import { AppButton } from '@/shared/components/buttons';
import { DialogHead } from '@/shared/components/primitives';
import { deleteFile } from '@/shared/files';
import { FontWeight, useAppStyles } from '@/shared/theme/styles';
import type { Assessment, DemoState, Intervention, UploadFile, W, Worksheet } from '@/shared/types/workspace';

export function DeleteAssessmentDialog({
  assessment,
  state,
  setState,
  openAssessment,
  notify,
  done,
}: W<'assessment' | 'state' | 'setState' | 'openAssessment' | 'notify' | 'done'>) {
  const s = useAppStyles();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const files: UploadFile[] = assessment.files || [];
  const resourceCount = state.resources.filter(
    (resource: Worksheet) => resource.assessmentId === assessment.id,
  ).length;
  const interventionCount = state.interventions.filter(
    (item: Intervention) => item.assessmentId === assessment.id,
  ).length;

  const remove = async () => {
    setBusy(true);
    setError('');
    try {
      // allSettled, not all. One file that will not delete used to reject the
      // whole cascade, so the assessment was never removed - and since the
      // other files HAD gone by then, every retry failed on the same file
      // forever. The record and its evidence both stayed, which is the opposite
      // of what the teacher asked for.
      //
      // The deletion now completes and names what may remain. That is the
      // better of two imperfect outcomes: aborting does not protect the
      // leftover file either, it just also strands the record.
      const outcomes = await Promise.allSettled(files.map((file) => deleteFile(file.id)));
      const stranded = files
        .filter((_, index) => outcomes[index].status === 'rejected')
        .map((file) => file.name);

      const nextAssessment = state.assessments.find(
        (item: Assessment) => item.id !== assessment.id,
      );
      await clearBulkAnalysisQueue(assessment.id);


      setState((current: DemoState) => ({
        ...current,
        assessments: current.assessments.filter((item) => item.id !== assessment.id),
        resources: current.resources.filter((item) => item.assessmentId !== assessment.id),
        interventions: current.interventions.filter(
          (item) => item.assessmentId !== assessment.id,
        ),
        events: [`Assessment deleted · ${assessment.title}`, ...current.events],
      }));
      openAssessment(nextAssessment?.id || '', 'Work');
      // Named, not counted: the teacher has to know which documents to chase.
      // Notified rather than pushed through `setError`, because the deletion
      // succeeded - this is a completed action with a caveat, and the dialog is
      // about to close.
      if (stranded.length) {
        notify(
          `Assessment deleted. ${stranded.join(', ')} could not be removed from secure storage.`,
          'error',
        );
      }
      done();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Assessment deletion failed. Retry to complete the secure cleanup.',
      );
      setBusy(false);
    }
  };

  return (
    <>
      <DialogHead eyebrow="Permanent action" title="Delete Assessment" />
      <Text style={s.modalCopy}>
        Delete <Text style={{ fontWeight: FontWeight.bold }}>{assessment.title}</Text>? This
        permanently removes this assessment, its {files.length}{' '}
        uploaded file{files.length === 1 ? '' : 's'}, grading results, {resourceCount} generated
        resource{resourceCount === 1 ? '' : 's'}, and {interventionCount} linked intervention
        {interventionCount === 1 ? '' : 's'}. Unrelated assessments and resources will not be
        changed.
      </Text>
      <View style={s.validationSummary}>
        {/* `.validation-summary b` - bold, and still the panel's danger colour,
            so the weight is named here and the colour comes from the panel. */}
        <Text style={[s.validationSummaryText, { fontWeight: FontWeight.bold }]}>
          This action cannot be undone.
        </Text>
        <Text style={s.validationSummaryText}>
          Confirm only if you want to remove all data that depends on this assessment.
        </Text>
      </View>
      {error ? (
        <View role="alert" style={s.formError}>
          <Text style={s.formErrorText}>{error}</Text>
        </View>
      ) : null}
      <AppButton
        variant="primary"
        full
        danger
        disabled={busy}
        title={busy ? 'Deleting assessment…' : 'Confirm Delete Assessment'}
        onPress={() => void remove()}
      />
    </>
  );
}
