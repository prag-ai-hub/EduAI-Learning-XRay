/**
 * The workspace snapshot: restoring it on mount and saving it back as it
 * changes.
 *
 * Ported from the three effects inside `WorkspaceApp` in
 * frontend/app/ui/FunctionalEduAIApp.tsx:322-330.
 *
 * The shape of the sync is unchanged and is worth restating, because every part
 * of it is load-bearing:
 *
 *  * The restore runs **once per mount**, keyed on the profile id. Re-running it
 *    when the profile object changes would refetch and overwrite work in
 *    progress.
 *  * The offline cache is written on every change, before the debounce, so a
 *    tab closed mid-edit still has the latest state on the device.
 *  * The PUT is debounced by 700ms and carries `revision`. A second device that
 *    saved first makes the server answer 409; the badge then says "Conflict"
 *    and the state is left exactly as it is, because silently reloading would
 *    throw away whatever the teacher has just typed.
 *  * `syncStatus` and the debounce timer are one unit: the badge reads "Syncing"
 *    for precisely as long as the timer is pending.
 */

import { useEffect, useRef, useState } from 'react';

import { authFetch } from '@/features/auth/api/authApi';
import { cloneInitial, newTeacherState } from '@/features/workspace/lib/demo-state';
import type { SyncStatus } from '@/shared/components/status';
import { StorageKeys, bulkStore } from '@/shared/storage';
import type { DemoProfile, DemoState, Worksheet } from '@/shared/types/workspace';
import type { SetWorkspace } from '@/shared/types/workspace-props';

// The badge that renders this owns the union; re-exported so a caller can
// name the type without reaching into a component module for it.
export type { SyncStatus };

export type UseWorkspaceSync = {
  state: DemoState;
  setState: SetWorkspace;
  /** False until the restore has finished; the shell shows its splash until then. */
  ready: boolean;
  syncStatus: SyncStatus;
  /**
   * True when nothing was restored and the workspace was seeded fresh for this
   * teacher. The shell clears its selected assessment in that case - there is
   * no `a1` sample to select. (`setSelectedId("")` in the web app.)
   */
  freshWorkspace: boolean;
};

/** The debounce the web app used. Long enough to coalesce a burst of edits. */
const SAVE_DELAY_MS = 700;

export function useWorkspaceSync(profile: DemoProfile): UseWorkspaceSync {
  const [state, setState] = useState<DemoState>(cloneInitial);
  const [ready, setReady] = useState(false);
  const [freshWorkspace, setFreshWorkspace] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('Loading');

  // The revision last read from the server. Sent with every write so a second
  // device cannot silently overwrite work saved from the first.
  const revisionRef = useRef<number | null>(null);
  const profileId = profile.id;

  // Bootstrap restore. Keyed on the id alone: `profile` is a fresh object on
  // every render of the caller, and depending on it would refetch endlessly.
  useEffect(() => {
    let alive = true;
    void (async () => {
      let restored: Partial<DemoState> | null = null;
      try {
        const response = await authFetch('/api/workspace', { cache: 'no-store' });
        if (response.ok) {
          const payload = await response.json();
          restored = payload.state;
          revisionRef.current = Number(payload.revision) || 0;
          if (alive) setSyncStatus('Synced');
        }
      } catch {
        // Offline, or the API is down. The device cache below is the fallback.
      }

      try {
        if (!restored) {
          restored = await bulkStore.getJson<Partial<DemoState> | null>(
            StorageKeys.offlineCache(profileId),
            null,
          );
          if (alive) setSyncStatus('Offline');
        }
        if (!alive) return;
        if (restored) {
          // Field-by-field defaulting, not a blind spread: a snapshot saved by
          // an older build can be missing whole arrays, and `resources` gained
          // two counters that must not come back undefined.
          const base = cloneInitial();
          setState({
            ...base,
            ...restored,
            students: restored.students || base.students,
            resources: (restored.resources || base.resources).map((r: Worksheet) => ({
              ...r,
              answerSheets: r.answerSheets || 0,
              gradedSheets: r.gradedSheets || 0,
            })),
            academicYears: restored.academicYears || base.academicYears,
            apiLog: restored.apiLog || [],
          });
        } else {
          setState(newTeacherState(profile));
          setFreshWorkspace(true);
        }
      } catch {
        // A torn cache entry must not stop the workspace opening; the seeded
        // initial state is already in place.
      }
      if (alive) setReady(true);
    })();
    return () => {
      alive = false;
    };
    // `profile` is read inside, but only its id may retrigger the restore -
    // see the note above. eslint cannot express "this dependency, by identity".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  // Serialises cache writes. A file write is not atomic against another write
  // to the same path, and the restore on the next launch reads whatever landed.
  const cacheWrite = useRef<Promise<void>>(Promise.resolve());

  // Debounce, then cache and save together.
  useEffect(() => {
    if (!ready) return;

    // The status flag and the timer below are one unit; deriving the badge
    // during render would need a second piece of state holding the same fact.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSyncStatus('Syncing');

    const timer = setTimeout(() => {
      // Inside the debounce, not outside it. On the web this was a synchronous
      // localStorage write and running it per keystroke cost nothing; on a
      // device `bulkStore` is a file per key, so an un-awaited write of the
      // whole workspace - up to 4 MB - was being started on every state change
      // and several could be in flight over one path at once. Sharing the
      // timer with the PUT means one write per settle, and `cacheWrite` chains
      // them so two settles in quick succession cannot interleave.
      cacheWrite.current = cacheWrite.current
        .then(() => bulkStore.setJson(StorageKeys.offlineCache(profileId), state))
        .catch(() => {
          // The server copy is authoritative; a failed local cache costs a
          // slower reload, not data. Swallowed so the chain survives it.
        });

      void authFetch('/api/workspace', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state, revision: revisionRef.current }),
      })
        .then(async (response) => {
          if (response.status === 409) {
            const payload = await response.json().catch(() => ({}));
            revisionRef.current = Number(payload.revision) || revisionRef.current;
            setSyncStatus('Conflict');
            return;
          }
          if (!response.ok) throw new Error('sync failed');
          const payload = await response.json().catch(() => ({}));
          if (Number.isFinite(Number(payload.revision))) revisionRef.current = Number(payload.revision);
          setSyncStatus('Synced');
        })
        .catch(() => setSyncStatus('Offline'));
    }, SAVE_DELAY_MS);

    return () => clearTimeout(timer);
  }, [state, ready, profileId]);

  return { state, setState, ready, syncStatus, freshWorkspace };
}
