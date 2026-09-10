/**
 * Import a whole class list from the spreadsheet the school already keeps.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx `RosterImport` (~1633).
 *
 * The parsing itself is not here: `@/features/workspace/lib/roster` owns the
 * header matching and both file formats, because the same rules have to hold
 * wherever a roster arrives from. This file is the dialog around it - choose a
 * file, refuse what cannot be read, and say how many students landed.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTE
 * ---------------------------------------------------------------------------
 * The web read the picked `File` in place: `await file.text()` for a CSV and
 * `await file.arrayBuffer()` for a workbook. Neither exists on a device -
 * React Native's Blob has no `arrayBuffer()`, and a picked document arrives as
 * a URI rather than as bytes. `@/shared/files` is the one reader that serves
 * both platforms, so the roster is put through the file store, read back, and
 * removed again the moment it is parsed. That round trip is the deviation the
 * platform forces; the parse it feeds is byte-for-byte the web's.
 *
 * The `.dropzone` with its hidden `<input type="file">` is `DropZone` from
 * `@/shared/components/file-picker`, which also keeps the drag-and-drop the
 * web had - on web only, where dragging means something.
 */

import { useState } from 'react';

import {
  parseRosterCsv,
  rosterRowsFromWorkbook,
  type RosterRow,
} from '@/features/workspace/lib/roster';
import { AppButton } from '@/shared/components/buttons';
import { DropZone, type PickedFile } from '@/shared/components/file-picker';
import { FormError } from '@/shared/components/form';
import { DialogHead } from '@/shared/components/primitives';
import { deleteFile, readFileBytes, readFileText, saveFile } from '@/shared/files';
import type { DemoState, W } from '@/shared/types/workspace';

/** The ceiling the web enforced on the picked file, in bytes. */
const MAX_ROSTER_BYTES = 5 * 1024 * 1024;

/**
 * Read and parse the roster, or null when the extension is not one of the two
 * the importer understands.
 *
 * The stored copy is deleted as soon as it has been read: a list of children's
 * names is not something to leave in storage for the sake of a parse, and the
 * import writes what it needs into the workspace.
 */
async function readRoster(file: PickedFile): Promise<RosterRow[] | null> {
  const lower = file.name.toLowerCase();
  const workbook = lower.endsWith('.xlsx') || lower.endsWith('.xls');
  if (!workbook && !lower.endsWith('.csv')) return null;

  const id = `roster-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await saveFile(id, file.source);
  try {
    if (workbook) {
      const bytes = await readFileBytes(id);
      return bytes ? await rosterRowsFromWorkbook(bytes) : [];
    }
    const text = await readFileText(id);
    return text ? parseRosterCsv(text) : [];
  } finally {
    // Best effort: failing to tidy up must not fail an import that worked.
    void deleteFile(id).catch(() => undefined);
  }
}

export function RosterImport({ setState, done }: W<'setState' | 'done'>) {
  const [file, setFile] = useState<PickedFile | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!file) {
      setError('Choose a CSV or XLSX roster.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const rows = await readRoster(file);
      if (rows === null) {
        setError('Unsupported file type. Upload a .csv or .xlsx roster.');
        return;
      }
      if (!rows.length) {
        setError(
          'No valid rows found. Make sure the file has a header row with Name, Roll and Class columns.',
        );
        return;
      }
      setState((current: DemoState) => ({
        ...current,
        students: [
          ...current.students,
          ...rows.map((row) => ({
            id: `s${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
            name: row.name,
            roll: row.roll || '—',
            className: row.className,
            status: 'Active',
          })),
        ],
        events: [
          `Roster imported · ${file.name} · ${rows.length} student${rows.length === 1 ? '' : 's'}`,
          ...current.events,
        ],
      }));
      done();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `Could not read the file: ${cause.message}`
          : 'Could not read the file.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DialogHead eyebrow="Roster import" title="Import students" />
      <DropZone
        title={file ? file.name : 'Choose CSV or XLSX roster'}
        caption="Header row required with Name, Roll and Class columns. CSV and XLSX both parsed for real."
        accept=".csv,.xlsx,.xls"
        multiple={false}
        onPicked={(files) => {
          const picked = files[0];
          if (!picked) return;
          // An oversized file is refused without replacing the current choice,
          // exactly as the web app's change handler did.
          if (picked.size > MAX_ROSTER_BYTES) {
            setError('Roster exceeds the 5 MB limit.');
            return;
          }
          setFile(picked);
          setError('');
        }}
      />
      <FormError>{error}</FormError>
      <AppButton
        title={busy ? 'Reading file…' : 'Validate & import roster'}
        variant="primary"
        full
        disabled={busy}
        onPress={() => void run()}
      />
    </>
  );
}
