/**
 * The bridge between the roster API and the workspace snapshot.
 *
 * ---------------------------------------------------------------------------
 * TEMPORARY. Delete this module when the last reader below is ported.
 * ---------------------------------------------------------------------------
 *
 * `/api/v1/schools/classes/` and `/api/v1/schools/students/` are the source of
 * truth for a school's structure and roster. `DemoState.classes` and
 * `DemoState.students` are a cache of them, and nothing more.
 *
 * The cache still has to be written because several screens have not been
 * ported off it yet: the assessment pickers and the heatmap read
 * `classSubjectOptions(state)`, `StudentsView` and `StudentEvidence` read
 * `state.students`, and the admin overview counts `state.classes`. If the
 * roster screens simply stopped writing the snapshot, those screens would show
 * a school with no classes rather than the classes it just created - a worse
 * failure than the stale-cache one this trades for.
 *
 * So: after every successful read, mirror the server's rows here. The rule is
 * one-directional - the API is written first and the snapshot second, never the
 * other way round - and nothing in the product should ever read a roster out of
 * the snapshot once its screen has been ported.
 */

import type { SchoolClass, Student } from '@/features/roster/api/rosterApi';
import type { DemoState, Student as WorkspaceStudent } from '@/shared/types/workspace';

/**
 * One class as `DemoState.classes` spells it:
 * `"Class 6C · Mathematics · 30 students"`.
 *
 * The third segment is not decoration. `classSubjectOptions` in
 * `@/features/workspace/lib/analytics` splits this string on the middot and
 * reads it positionally - `parts[0]` for the grade and section, `parts[1]` for
 * the subject, and `parts[2]` for the student strength, through `/\d+/`. The
 * API's `label` is only the first two segments, so mirroring `label` alone
 * would leave every class in the pickers with a strength of 0, which is what
 * the heatmap and the class-strength figures are built from.
 */
export function classRow(entry: SchoolClass): string {
  return `${entry.label} · ${entry.student_count} students`;
}

/** One student in the snapshot's shape. `className` there is display text. */
export function studentRow(entry: Student): WorkspaceStudent {
  return {
    id: entry.id,
    name: entry.name,
    // The snapshot's `roll` is a string the roster screen prints and searches;
    // the API's is nullable. "—" is what the import wrote for a missing one.
    roll: entry.roll_number || '—',
    className: entry.class_label || 'No class yet',
    status: entry.status,
  };
}

/** Replace the cached class list with the server's. */
export function mirrorClasses(rows: readonly SchoolClass[]) {
  return (current: DemoState): DemoState => ({ ...current, classes: rows.map(classRow) });
}

/** Replace the cached roster with the server's. */
export function mirrorStudents(rows: readonly Student[]) {
  return (current: DemoState): DemoState => ({ ...current, students: rows.map(studentRow) });
}

/**
 * Fold one newly created class into the cache, with the activity row the
 * dialog has always written.
 *
 * Any cached row for the same class, section and subject is dropped first, so
 * re-entering a class updates it instead of listing it twice. The comparison
 * normalises the mis-encoded separator ("Â·") that older snapshots were written
 * with, exactly as the dialog did before it talked to a server - without that,
 * a duplicate survives a plain `startsWith`.
 */
export function addClass(created: SchoolClass) {
  const prefix = `${created.label} ·`;
  return (current: DemoState): DemoState => ({
    ...current,
    classes: [
      classRow(created),
      ...current.classes.filter((item) => !item.replace('Â·', '·').startsWith(prefix)),
    ],
    events: [`Class subject created · ${created.label}`, ...current.events],
  });
}

/** Fold one newly created student into the cache. */
export function addStudent(created: Student) {
  return (current: DemoState): DemoState => ({
    ...current,
    students: [
      studentRow(created),
      ...current.students.filter((item) => item.id !== created.id),
    ],
    events: [
      `Student added · ${created.roll_number || created.name}`,
      ...current.events,
    ],
  });
}
