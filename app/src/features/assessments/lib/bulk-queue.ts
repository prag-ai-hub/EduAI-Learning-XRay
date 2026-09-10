import { StorageKeys, appStore } from '@/shared/storage';

/**
 * The bulk-analysis work queue: which answer sheets of one assessment are still
 * waiting to be analysed.
 *
 * The wizard writes the queue, each per-file grade dialog advances it when it
 * finishes, and the auto-OCR effect reads it to decide whether it was opened as
 * part of a run or by hand. Deleting the assessment clears it.
 *
 * Ported from FunctionalEduAIApp.tsx:1012-1015, plus the inline
 * `sessionStorage.removeItem(bulkQueueKey(assessment.id))` in
 * DeleteAssessmentDialog (:1697), which is `clearBulkAnalysisQueue` here so the
 * key is not spelled out in two places.
 *
 * ---------------------------------------------------------------------------
 * Two things changed in the port, and callers must know both
 * ---------------------------------------------------------------------------
 *
 * 1. **These are async.** The web app used `sessionStorage`, which is
 *    synchronous; there is no synchronous key/value store on a device, so
 *    `@/shared/storage` is promise-based throughout. Every call site has to
 *    await - in particular the auto-OCR effect that reads the queue to decide
 *    whether to start on mount.
 *
 * 2. **The queue now outlives the tab.** `appStore` is `localStorage` on web and
 *    a file on native, where `sessionStorage` was dropped when the tab closed.
 *    A run interrupted by a reload therefore resumes rather than being
 *    forgotten, which is the better behaviour but is a behaviour change; it is
 *    also why `clearBulkAnalysisQueue` matters more than it did.
 *
 * Failures are swallowed, as they were before. A queue is a convenience: losing
 * it costs the teacher a click, and there is nothing useful to say about a
 * storage backend that has gone away mid-run.
 */

/** Persist the file ids still to be analysed, in order. */
export async function saveBulkAnalysisQueue(assessmentId: string, fileIds: string[]): Promise<void> {
  try {
    await appStore.setJson(StorageKeys.bulkAnalysisQueue(assessmentId), fileIds);
  } catch {
    // A queue that cannot be stored simply means the run is not resumable.
  }
}

/** The file ids still queued. Empty when there is no run in progress. */
export async function bulkAnalysisQueue(assessmentId: string): Promise<string[]> {
  try {
    const queue = await appStore.getJson<unknown>(StorageKeys.bulkAnalysisQueue(assessmentId), []);
    // A hand-edited or half-written value must not crash the wizard; anything
    // that is not a list of strings is treated as no queue at all.
    return Array.isArray(queue) ? queue.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Drop a finished file from the queue and return the next one to open, or ""
 * when the run is complete. The key is removed once nothing is left, so an
 * empty queue and no queue are the same state.
 */
export async function advanceBulkAnalysisQueue(
  assessmentId: string,
  completedFileId: string,
): Promise<string> {
  try {
    const queue = await bulkAnalysisQueue(assessmentId);
    const remaining = queue.filter((id) => id !== completedFileId);
    if (remaining.length) await appStore.setJson(StorageKeys.bulkAnalysisQueue(assessmentId), remaining);
    else await appStore.remove(StorageKeys.bulkAnalysisQueue(assessmentId));
    return remaining[0] || '';
  } catch {
    return '';
  }
}

/** Abandon the run - the assessment was deleted, or the teacher stopped it. */
export async function clearBulkAnalysisQueue(assessmentId: string): Promise<void> {
  try {
    await appStore.remove(StorageKeys.bulkAnalysisQueue(assessmentId));
  } catch {
    // Nothing to recover: the caller is on its way out of this assessment.
  }
}
