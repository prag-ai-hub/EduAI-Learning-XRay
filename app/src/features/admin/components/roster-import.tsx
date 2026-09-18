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
 * What the parse feeds has changed. The rows used to be written straight into
 * the workspace snapshot with invented ids, which is to say a school could
 * import three hundred children and the product would still have none. They now
 * go to `POST /api/v1/schools/students/import/`, which is one transaction: a
 * file with a bad line on row 40 leaves no half-imported roster, and a row whose
 * roll number already exists updates that child rather than creating a second
 * one. The snapshot is written afterwards from what the server returns - see
 * `@/features/roster/lib/workspace-mirror` for why that cache still exists.
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
import { Text, View } from 'react-native';

import {
  ApiError,
  importRoster,
  listStudents,
  rowProblems,
  spreadsheetClassLabel,
  type RosterImportResult,
  type RosterImportRow,
  type RosterRowProblem,
} from '@/features/roster/api/rosterApi';
import { mirrorStudents } from '@/features/roster/lib/workspace-mirror';
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
import { useAppStyles } from '@/shared/theme/styles';
import type { W } from '@/shared/types/workspace';

/** The ceiling the web enforced on the picked file, in bytes. */
const MAX_ROSTER_BYTES = 5 * 1024 * 1024;

/**
 * Read and parse the roster, or null when the extension is not one of the two
 * the importer understands.
 *
 * The stored copy is deleted as soon as it has been read: a list of children's
 * names is not something to leave in storage for the sake of a parse, and the
 * import sends what it needs to the service.
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

/** The parsed rows, in the shape the import endpoint takes. */
function toImportRows(rows: readonly RosterRow[]): RosterImportRow[] {
  return rows.map((row) => {
    const label = spreadsheetClassLabel(row.className);
    return {
      name: row.name,
      ...(row.roll ? { roll_number: row.roll } : {}),
      // Omitted rather than blank: no class is a valid row, and the server
      // files that child with none rather than refusing the import.
      ...(label ? { class_label: label } : {}),
    };
  });
}

export function RosterImport({ setState, done }: W<'setState' | 'done'>) {
  const s = useAppStyles();
  const [file, setFile] = useState<PickedFile | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<RosterRowProblem[]>([]);
  const [result, setResult] = useState<RosterImportResult | null>(null);

  // No class list is read here. The server resolves every class label itself
  // and names the rows it cannot - reading them here as well would be a second
  // implementation of one rule, free to drift from the one that decides.

  const run = async () => {
    if (!file) {
      setError('Choose a CSV or XLSX roster.');
      return;
    }
    setError('');
    setProblems([]);
    setBusy(true);
    // Hoisted so the failure path can name rows without reading the file a
    // second time - `readRoster` stores and deletes it as it goes.
    let rows: RosterImportRow[] = [];
    try {
      const parsed = await readRoster(file);
      if (parsed === null) {
        setError('Unsupported file type. Upload a .csv or .xlsx roster.');
        return;
      }
      if (!parsed.length) {
        setError(
          'No valid rows found. Make sure the file has a header row with Name, Roll and Class columns.',
        );
        return;
      }

      rows = toImportRows(parsed);

      const outcome = await importRoster(rows);
      setResult(outcome);
      // The snapshot is a cache of the roster, so it is refilled from the
      // server rather than from the file that was just parsed.
      try {
        setState(mirrorStudents(await listStudents({ status: 'Active' })));
      } catch {
        // The import happened; a failed re-read must not report otherwise.
      }
    } catch (cause) {
      // The server names the rows it refused, and the whole import is one
      // transaction - so nothing was written and the office fixes the file.
      const refused = rowProblems(cause);
      if (refused.length) {
        setProblems(refused);
        setError(
          `Nothing was imported. ${refused.length} row${refused.length === 1 ? '' : 's'} need ` +
            'fixing - see below, then try again.',
        );
        return;
      }
      setError(
        cause instanceof ApiError
          ? cause.message
          : cause instanceof Error
            ? `Could not read the file: ${cause.message}`
            : 'Could not read the file.',
      );
    } finally {
      setBusy(false);
    }
  };

  if (result)
    return (
      <>
        <DialogHead eyebrow="Roster import" title="Roster imported" />
        <Text style={s.modalCopy}>
          {result.created} student{result.created === 1 ? '' : 's'} added and {result.updated}{' '}
          updated, {result.total} in total. A row whose roll number already existed updated that
          student rather than creating a second one.
        </Text>
        <AppButton title="Done" variant="primary" full onPress={done} />
      </>
    );

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
          setProblems([]);
        }}
      />
      <FormError>{error}</FormError>
      {/* Row numbers count the rows that were sent, which is the file's data
          rows with the header and any nameless line already dropped. */}
      {problems.map((problem) => (
        <View key={problem.row} style={s.listItem}>
          <View style={s.listItemBody}>
            <Text style={s.listItemText}>Row {problem.row}</Text>
            <Text style={s.listItemCaption}>{problem.detail}</Text>
          </View>
        </View>
      ))}
      <AppButton
        title={busy ? 'Importing roster…' : 'Validate & import roster'}
        variant="primary"
        full
        disabled={busy}
        onPress={() => void run()}
      />
    </>
  );
}
