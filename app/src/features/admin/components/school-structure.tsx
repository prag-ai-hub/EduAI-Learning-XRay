/**
 * The three dialogs that define what a school *is*: its classes, its profile
 * and its calendar.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx `ClassDialog` (~1581),
 * `SchoolDialog` (~1582) and `AcademicYearDialog` (~1680).
 *
 * `SchoolDialog` and `AcademicYearDialog` still write into the workspace
 * snapshot as formatted strings rather than as records - `schools` and
 * `academicYears` are `string[]` on `DemoState`, and the separator (" · ") is
 * what every reader splits on. Their shapes are kept exactly, because the class
 * picker, the heatmap and the assessment dialogs all parse them.
 *
 * `ClassDialog` no longer does. It creates a real class through
 * `POST /api/v1/schools/classes/`, and writes the snapshot only afterwards, as
 * a cache of what the server said - see `@/features/roster/lib/workspace-mirror`
 * for why that cache still exists and when it goes away. It used to write the
 * snapshot and nothing else, which meant a school could "create a class" that
 * no teacher, parent or assessment could ever attach to.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTE
 * ---------------------------------------------------------------------------
 * Each was a `<form onSubmit>` reading `new FormData(event.currentTarget)`;
 * `@/shared/components/form` is that contract rebuilt, so `values.get("name")`
 * replaces `String(f.get("name"))` and the fields stay uncontrolled. The
 * monolith's `<Field label>{children}` is a label wrapper and a different
 * component from this app's `Field`: a `<select>` inside one becomes `Select`,
 * an `<input>` becomes `Field`.
 *
 * The unnamed controls stay unnamed - the verified domain and the two academic
 * year dates were never read back on the web either, because an unnamed DOM
 * input never reaches FormData. They are still `required` where they were, and
 * the form refuses to submit without them exactly as the browser did.
 */

import { Text } from 'react-native';

import { createClass } from '@/features/roster/api/rosterApi';
import { addClass } from '@/features/roster/lib/workspace-mirror';
import { Field, Form, FormError, FormGrid, Select, SubmitButton } from '@/shared/components/form';
import { DialogHead } from '@/shared/components/primitives';
import { useAppStyles } from '@/shared/theme/styles';
import type { DemoState, User, W } from '@/shared/types/workspace';

const BOARDS = ['CBSE', 'ICSE', 'State Board', 'IB'];

const YEAR_STATUSES = ['Planned', 'Active', 'Archived'];

/**
 * Create a class, its section and its subject in one go.
 *
 * Three things about this form are the server's rules rather than this file's:
 *
 *  * **The teacher is sent as an id.** The picker used to submit nothing at all
 *    - its `<Select>` had no `name`, so the chosen name never left the dialog.
 *    Now it carries `user.id`, and only a Teacher of this school is accepted;
 *    any other id gets "No such teacher at this school.", which is deliberately
 *    the same answer as an id that does not exist.
 *  * **The academic year is not asked for.** It defaults server-side to the
 *    current Indian school year, which turns over in June. A school office
 *    adding a class in March should not have to know that.
 *  * **A duplicate is refused, not merged.** The old dialog replaced any
 *    snapshot row with the same class/section/subject, which looked like an
 *    update and was really a second copy of a class nobody else could see.
 *    `classes_identity_key` makes the real one a 400 with a readable message,
 *    and the message is shown.
 *
 * "Student strength" is gone with it. It fed the number in the snapshot string
 * and nothing else; the server counts the roster instead, so a typed strength
 * would have been a figure the product then quietly disagreed with.
 */
export function ClassDialog({ state, setState, done }: W<'state' | 'setState' | 'done'>) {
  const s = useAppStyles();
  const teachers = state.users
    .filter((user: User) => user.role === 'Teacher')
    .map((user: User) => ({ label: user.name, value: user.id }));

  return (
    <Form
      onSubmit={async (values) => {
        // Anything thrown here lands in <FormError/> - so an ApiError's message
        // is the server's own wording, including the 403 a school that has not
        // been approved yet gets for every write.
        const created = await createClass({
          class_name: values.trimmed('className'),
          section: values.trimmed('section'),
          subject: values.trimmed('subject'),
          teacher: values.trimmed('teacher') || null,
        });
        setState(addClass(created));
        done();
      }}>
      <DialogHead eyebrow="Class-first analysis" title="Create class & subject" />
      <Text style={s.modalCopy}>
        Create the class and section first, then attach its subject. Assessments and heatmaps use
        this exact structure.
      </Text>
      <FormGrid>
        <Field name="className" label="Class" required defaultValue="6" />
        <Field name="section" label="Section" required defaultValue="C" />
        <Field name="subject" label="Subject" required defaultValue="Mathematics" />
      </FormGrid>
      {/* A placeholder rather than a pre-selected first teacher: a class with
          nobody assigned is valid, and picking one for the administrator would
          put a name on a class they never chose. */}
      <Select
        name="teacher"
        label="Assigned teacher"
        options={teachers}
        disabled={!teachers.length}
        placeholder={teachers.length ? 'No teacher assigned yet' : 'No teachers invited yet'}
      />
      <FormError />
      <SubmitButton title="Save class & subject" />
    </Form>
  );
}

/** The tenant's own profile - name, city and board, as one `schools` row. */
export function SchoolDialog({ setState, done }: W<'setState' | 'done'>) {
  return (
    <Form
      onSubmit={(values) => {
        const name = values.get('name');
        const row = `${name} · ${values.get('city')} · ${values.get('board')}`;
        setState((current: DemoState) => ({
          ...current,
          schools: [row, ...current.schools.filter((item) => !item.startsWith(name))],
        }));
        done();
      }}>
      <DialogHead eyebrow="Tenant profile" title="Manage school" />
      <Field name="name" label="School name" required defaultValue="Sunrise Academy" />
      <FormGrid>
        <Field name="city" label="City" required defaultValue="Mumbai" />
        <Select name="board" label="Board / curriculum" options={BOARDS} />
      </FormGrid>
      <Field label="Verified domain" defaultValue="sunrise.edu" />
      <SubmitButton title="Save school" />
    </Form>
  );
}

/** One academic year and where it stands in the calendar. */
export function AcademicYearDialog({ setState, done }: W<'setState' | 'done'>) {
  return (
    <Form
      onSubmit={(values) => {
        setState((current: DemoState) => ({
          ...current,
          academicYears: [
            `${values.get('name')} · ${values.get('status')}`,
            ...current.academicYears,
          ],
        }));
        done();
      }}>
      <DialogHead eyebrow="School calendar" title="Academic year" />
      <Field name="name" label="Name" required placeholder="2027–28" />
      <FormGrid>
        <Field label="Start date" type="date" required />
        <Field label="End date" type="date" required />
      </FormGrid>
      <Select name="status" label="Status" options={YEAR_STATUSES} />
      <SubmitButton title="Save academic year" />
    </Form>
  );
}
