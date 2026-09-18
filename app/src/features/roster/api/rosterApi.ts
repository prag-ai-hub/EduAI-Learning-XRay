/**
 * The school roster's network surface: the classes a school teaches, the
 * students on them, and the spreadsheet import that fills both.
 *
 * Everything here is Django (`/api/v1/schools/classes/` and
 * `/api/v1/schools/students/`, plan row 17.4). That is worth saying plainly,
 * because until this module existed the SchoolAdmin's class and student dialogs
 * made no network call at all - they wrote a formatted string into the
 * workspace snapshot and closed. A school that "created a class" created
 * nothing any other part of the product could see, and nothing a teacher,
 * a parent or an assessment could ever attach to.
 *
 * Three rules the server owns, restated here only so a caller knows not to
 * re-implement them:
 *
 *  * **The school is never in the request.** Every row is scoped to the
 *    caller's own school by the tenancy mixin, and a `school` field in a body
 *    is ignored rather than trusted. So there is no school parameter below.
 *  * **`academic_year` defaults server-side** to the current Indian school
 *    year, which turns over in June. It is sent only when a school picks one.
 *  * **Writes need an approved school.** A Pending, Suspended or Closed school
 *    may read its roster and may not change it; the refusal is a 403 whose
 *    message names the status. Show it - the wording is the product's answer to
 *    "why is nothing saving", and inventing a friendlier one loses the reason.
 *
 * No UI concerns live here. Errors are left as `ApiError` for the screen to
 * render, because a dialog, a list and a toast each want to say it differently.
 */

import { ApiError, api, type Paginated } from '@/shared/api/django';

/* ------------------------------------------------------------------------- *
 * Shapes, as the DRF serializers return them
 * ------------------------------------------------------------------------- */

/** One teaching unit, as `SchoolClassSerializer` returns it. */
export type SchoolClass = {
  id: string;
  academic_year: string;
  class_name: string;
  section: string;
  subject: string;
  /** The assigned teacher's user id, or null. */
  teacher: string | null;
  teacher_name: string | null;
  student_count: number;
  /**
   * "Class 6C · Mathematics", already formatted by the server. Render it;
   * rebuilding it from the parts is how two spellings of one class appear.
   */
  label: string;
};

/**
 * What creating a class takes.
 *
 * `class_name` is "1".."12" and nothing else - the column carries a check
 * constraint and the serializer states it again, so "VI" and "6th" are refused
 * with "Use a class from 1 to 12.". `section` is upper-cased server-side.
 * `teacher` is a user id, and the server accepts only a Teacher of this school;
 * anything else - another school's teacher, a SchoolAdmin, an id that does not
 * exist - is the same refusal, "No such teacher at this school.", on purpose.
 */
export type NewSchoolClass = {
  class_name: string;
  section: string;
  subject: string;
  teacher?: string | null;
  academic_year?: string;
};

export type StudentStatus = 'Active' | 'Inactive';

/** A child on the roster, as `StudentSerializer` returns them. */
export type Student = {
  id: string;
  name: string;
  roll_number: string | null;
  status: StudentStatus;
  /** The class id, or null - a school may import its roster before its classes. */
  school_class: string | null;
  class_label: string | null;
};

export type NewStudent = {
  name: string;
  roll_number?: string;
  school_class?: string | null;
};

/** One line of an import, in the wire shape `RosterRowSerializer` expects. */
export type RosterImportRow = {
  name: string;
  roll_number?: string;
  /** Spreadsheet-style: "6C", "6-c", "6 C". Not the formatted label. */
  class_label?: string;
};

export type RosterImportResult = { created: number; updated: number; total: number };

/** One refused line of an import, numbered from 1 over the rows that were sent. */
export type RosterRowProblem = { row: number; detail: string };

/* ------------------------------------------------------------------------- *
 * Paging
 * ------------------------------------------------------------------------- */

const CLASSES = '/api/v1/schools/classes/';
const STUDENTS = '/api/v1/schools/students/';

/** The service's `max_page_size`. Asking for more is refused, not truncated. */
const PAGE_SIZE = 100;

/**
 * A ceiling on how many pages one list call will walk, so a paging bug cannot
 * turn a screen into an unbounded request loop. 20 pages is 2,000 rows - past
 * any school's class list, and past the 500-row import bound for students.
 */
const MAX_PAGES = 20;

/**
 * Read every page of a list endpoint.
 *
 * These lists are paginated at 25 by default, and a secondary school with
 * twelve classes, four sections and five subjects has 240 rows - so reading
 * only the first page would silently hide most of a school's own structure.
 * Paged by number rather than by following `next`, because `next` is an
 * absolute URL and the client takes a path.
 */
async function allPages<T>(path: string, query: readonly string[] = []): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const suffix = [...query, `page_size=${PAGE_SIZE}`, `page=${page}`].join('&');
    const payload = await api.get<Paginated<T>>(`${path}?${suffix}`);
    rows.push(...payload.results);
    if (!payload.next) break;
  }
  return rows;
}

/* ------------------------------------------------------------------------- *
 * Classes
 * ------------------------------------------------------------------------- */

/** Every class this school teaches, ordered class, section, subject. */
export function listClasses(): Promise<SchoolClass[]> {
  return allPages<SchoolClass>(CLASSES);
}

/**
 * Create one class/section/subject.
 *
 * A duplicate for the same academic year is a 400 carrying a readable `detail`
 * ("That class, section and subject already exists for this year."), because
 * `classes_identity_key` is a database constraint and two requests can both
 * read "no such class" before either writes.
 */
export function createClass(input: NewSchoolClass): Promise<SchoolClass> {
  return api.post<SchoolClass>(CLASSES, {
    class_name: input.class_name,
    section: input.section,
    subject: input.subject,
    // Both are omitted rather than sent null: the server defaults the year, and
    // an absent teacher is not the same request as an explicit unassignment.
    ...(input.teacher ? { teacher: input.teacher } : {}),
    ...(input.academic_year ? { academic_year: input.academic_year } : {}),
  });
}

/** Change one class. PATCH, so an unmentioned field keeps its value. */
export function updateClass(id: string, patch: Partial<NewSchoolClass>): Promise<SchoolClass> {
  return api.patch<SchoolClass>(`${CLASSES}${encodeURIComponent(id)}/`, patch);
}

/**
 * Remove a class that has nobody in it.
 *
 * Refused with a 400 while students are still attached, and the message counts
 * them - `students.class_id` has no ON DELETE clause, so the alternative is an
 * orphaned child rather than a deleted class.
 */
export function deleteClass(id: string): Promise<void> {
  return api.del<void>(`${CLASSES}${encodeURIComponent(id)}/`);
}

/* ------------------------------------------------------------------------- *
 * Students
 * ------------------------------------------------------------------------- */

/** The roster, optionally narrowed to one class or one status. */
export function listStudents(filter: { classId?: string; status?: StudentStatus } = {}) {
  const query: string[] = [];
  if (filter.classId) query.push(`class=${encodeURIComponent(filter.classId)}`);
  if (filter.status) query.push(`status=${encodeURIComponent(filter.status)}`);
  return allPages<Student>(STUDENTS, query);
}

/**
 * Add one child to the roster.
 *
 * `school_class` is optional for the reason the serializer gives: a school
 * imports its roster before it has finished setting up its classes, and a
 * student with no class is still a student the product can show.
 */
export function createStudent(input: NewStudent): Promise<Student> {
  return api.post<Student>(STUDENTS, {
    name: input.name,
    ...(input.roll_number ? { roll_number: input.roll_number } : {}),
    ...(input.school_class ? { school_class: input.school_class } : {}),
  });
}

/**
 * Take a student off the roster.
 *
 * DELETE, and yet it answers 200 with the student rather than 204 with nothing:
 * the row is marked Inactive, never removed. Grade results, parent links and
 * audit rows all point at this id, so deleting it would either fail on a
 * foreign key or strand a parent's reports.
 */
export function removeStudent(id: string): Promise<Student> {
  return api.del<Student>(`${STUDENTS}${encodeURIComponent(id)}/`);
}

/* ------------------------------------------------------------------------- *
 * The spreadsheet import
 * ------------------------------------------------------------------------- */

/**
 * Import a whole roster in one request.
 *
 * All or nothing: every row is resolved and validated before anything is
 * written, so a file with a bad line on row 40 leaves no half-imported roster.
 * A row whose roll number already exists is an update, not a refusal - a school
 * correcting a typo re-imports the file, and that must not create a second
 * child. Bounded at 500 rows by the server.
 */
export function importRoster(rows: readonly RosterImportRow[]): Promise<RosterImportResult> {
  return api.post<RosterImportResult>(`${STUDENTS}import/`, { rows });
}

/**
 * "Class 6A" -> "6A". The importer's wire format for a class.
 *
 * A roster's class column is whatever the school office typed, and the parser
 * (`@/features/workspace/lib/roster`) hands it over untouched, including its
 * own "Class 6A" fallback for a file with no class column at all. The server
 * matches on "6A": it strips spaces and dashes and upper-cases, but it does not
 * know the word "Class", so "Class 6A" would be refused as a class that does
 * not exist. Dropping the word here is a format conversion, not a parse - the
 * parsing itself is deliberately left exactly as it was.
 */
export function spreadsheetClassLabel(className: string): string {
  return className.trim().replace(/^class\s+/i, '').trim();
}

/**
 * The rows the server refused, in its own words.
 *
 * The import answers a bad file with `{rows: [{row, detail}, …]}`, and
 * `ApiError` keeps that structure on `detail` precisely so a caller can point
 * at the line to fix. `fields.rows` carries the same thing already rendered as
 * "Row 2: …", which is the fallback when the shape is anything else.
 *
 * Deliberately NOT a second copy of the server's label matching: an earlier
 * version of this file resolved every row against the class list here, which
 * meant two implementations of one rule, each free to drift from the other.
 * The server resolves labels; this reads what it said.
 */
export function rowProblems(cause: unknown): RosterRowProblem[] {
  if (!(cause instanceof ApiError)) return [];

  const raw = (cause.detail as { rows?: unknown } | undefined)?.rows;
  if (Array.isArray(raw)) {
    const named = raw
      .map((entry) => entry as { row?: unknown; detail?: unknown })
      .filter((entry) => typeof entry.detail === "string")
      .map((entry) => ({
        row: typeof entry.row === "number" ? entry.row : 0,
        detail: String(entry.detail),
      }));
    if (named.length) return named;
  }

  // Already flattened to "Row 2: …" strings; keep the sentence, lose the number.
  return (cause.fields.rows ?? []).map((detail) => ({ row: 0, detail }));
}

export { ApiError };
