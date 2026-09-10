/**
 * Roster import parsing.
 *
 * A school hands over its student list as a CSV or an XLSX, with a header row
 * and no agreed column names. Both parsers below therefore find their columns
 * by looking for a substring in the header ("roll" or "id", "class" or "grade"
 * or "section") and fall back to position when the header says nothing useful.
 * A row with no name is dropped; a row with no class is filed under Class 6A,
 * which is the demo default the web app used.
 *
 * Ported from FunctionalEduAIApp.tsx:1602-1633, with the workbook branch of
 * RosterImport (:1645-1655) generalised into `rosterRowsFromWorkbook` - see
 * the note on it.
 */

/** One student as the importer understands them, before ids are minted. */
export type RosterRow = { name: string; roll: string; className: string };

/**
 * Locate the three columns in a lower-cased header row, and return the mapper
 * that reads a row of cells with them.
 *
 * Extracted because the CSV and the workbook path found them with identical
 * code in the web app, and a fix to one that missed the other would silently
 * import a roster with the roll numbers in the class column. Resolved once per
 * file, as before, not once per row.
 */
function rowReader(header: string[]): (cols: string[]) => RosterRow {
  const nameIdx = header.findIndex((h) => h.includes('name'));
  const rollIdx = header.findIndex((h) => h.includes('roll') || h.includes('id'));
  const classIdx = header.findIndex(
    (h) => h.includes('class') || h.includes('grade') || h.includes('section'),
  );
  return (cols) => ({
    name: nameIdx >= 0 ? cols[nameIdx] || '' : cols[0] || '',
    roll: rollIdx >= 0 ? cols[rollIdx] || '' : cols[1] || '',
    className: classIdx >= 0 ? cols[classIdx] || '' : cols[2] || 'Class 6A',
  });
}

/**
 * Parse a CSV roster.
 *
 * Split on "," and nothing more, exactly as the web app did: no quoted-field
 * handling, so a name written `"Bose, Mira"` lands in two columns. Kept as-is
 * because changing it would change which rosters import successfully, and that
 * is a product decision rather than a port decision.
 */
export function parseRosterCsv(text: string): RosterRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];
  const read = rowReader(lines[0].split(',').map((h) => h.trim().toLowerCase()));
  return lines
    .slice(1)
    .map((line) => read(line.split(',').map((c) => c.trim())))
    .filter((s) => s.name);
}

/** Parse an array-of-arrays sheet, as `XLSX.utils.sheet_to_json(..., {header:1})` returns it. */
export function rowsFromAOA(aoa: unknown[][]): RosterRow[] {
  if (!aoa.length) return [];
  const read = rowReader((aoa[0] || []).map((h) => String(h ?? '').trim().toLowerCase()));
  return aoa
    .slice(1)
    .map((row) => read(row.map((c) => String(c ?? '').trim())))
    .filter((s) => s.name);
}

/**
 * Parse an XLSX or XLS roster from its bytes.
 *
 * The web app read the workbook straight off the picked `File`
 * (`await file.arrayBuffer()`), which a React Native file cannot supply -
 * RN's Blob has no `arrayBuffer()`, and a picked document arrives as a URI.
 * Taking `Uint8Array` instead means both platforms feed it the same way, from
 * `readFileBytes(id)` in `@/shared/files`.
 *
 * `xlsx` is imported dynamically, as it was in RosterImport: it is a large
 * dependency that only the roster dialog reaches, and no other screen should
 * pay for it.
 */
export async function rosterRowsFromWorkbook(bytes: Uint8Array): Promise<RosterRow[]> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(bytes, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return [];
  const aoa = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: '',
  }) as unknown[][];
  return rowsFromAOA(aoa);
}
