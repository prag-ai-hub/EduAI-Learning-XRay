/**
 * The three dialogs that define what a school *is*: its classes, its profile
 * and its calendar.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx `ClassDialog` (~1581),
 * `SchoolDialog` (~1582) and `AcademicYearDialog` (~1680).
 *
 * All three write into the workspace snapshot as formatted strings rather than
 * as records - `classes`, `schools` and `academicYears` are `string[]` on
 * `DemoState`, and the separator (" · ") is what every reader splits on. The
 * shapes are kept exactly, because the class picker, the heatmap and the
 * assessment dialogs all parse them.
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

import { Field, Form, FormGrid, Select, SubmitButton } from '@/shared/components/form';
import { DialogHead } from '@/shared/components/primitives';
import { useAppStyles } from '@/shared/theme/styles';
import type { DemoState, W } from '@/shared/types/workspace';

const BOARDS = ['CBSE', 'ICSE', 'State Board', 'IB'];

const YEAR_STATUSES = ['Planned', 'Active', 'Archived'];

/**
 * Create a class, its section and its subject in one go.
 *
 * Saving replaces any existing row for the same class/section/subject rather
 * than adding a second one, which is how re-entering a class updates its
 * strength instead of duplicating it.
 */
export function ClassDialog({ state, setState, done }: W<'state' | 'setState' | 'done'>) {
  const s = useAppStyles();
  const teachers = state.users.filter((user) => user.role === 'Teacher').map((user) => user.name);

  return (
    <Form
      onSubmit={(values) => {
        const className = values.trimmed('className');
        const section = values.trimmed('section').toUpperCase();
        const subject = values.trimmed('subject');
        const row = `Class ${className}${section} · ${subject} · ${values.get('students')} students`;
        const prefix = `Class ${className}${section} · ${subject} ·`;
        setState((current: DemoState) => ({
          ...current,
          classes: [
            row,
            // Older rows were written with a mis-encoded separator ("Â·"), so a
            // duplicate would survive a plain startsWith. Normalising before the
            // comparison is what the web app did, and dropping it would leave two
            // rows for one class.
            ...current.classes.filter((item) => !item.replace('Â·', '·').startsWith(prefix)),
          ],
          events: [
            `Class subject created · Class ${className}${section} · ${subject}`,
            ...current.events,
          ],
        }));
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
        <Field
          name="students"
          label="Student strength"
          type="number"
          min={1}
          required
          defaultValue="30"
        />
      </FormGrid>
      <Select label="Assigned teacher" options={teachers} />
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
