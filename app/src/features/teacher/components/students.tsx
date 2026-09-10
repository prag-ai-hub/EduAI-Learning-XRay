/**
 * The Students module - the roster, with mastery drawn from graded evidence.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx `StudentsView` (~629).
 *
 * The mastery figure comes from `studentMastery`, never from a stored label:
 * that is the point of the screen's own subtitle - progress is evidence, not a
 * permanent ability class.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTE
 * ---------------------------------------------------------------------------
 * `.user-row` is a wrapping flex row here rather than a grid, so its cells
 * carry their own track weights (`userRowIdentity`, `userRowCell`,
 * `userRowActions`) exactly as the performance matrix's drill-down does. Below
 * 760px the stylesheet hides the middle cells and drops the actions onto their
 * own line, which is what the CSS did.
 *
 * The search box was a bare `.compact-input` with no label, so it is a
 * `TextInput`, not `form.tsx`'s `Field` - that one renders a label wrapper and
 * belongs inside a `<Form>`.
 */

import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { studentMastery } from '@/features/workspace/lib/analytics';
import { CardHead, Card, PageHead } from '@/shared/components/primitives';
import { StatusPill } from '@/shared/components/status';
import { AppButton } from '@/shared/components/buttons';
import { useAppPalette, useAppStyles } from '@/shared/theme/styles';
import type { Student, W } from '@/shared/types/workspace';

/** "Aarav Sharma" -> "AS". Unchanged: the web took the first letter of every word. */
function initialsOf(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('');
}

export function StudentsView({ state, open }: W<'state' | 'open'>) {
  const s = useAppStyles();
  const p = useAppPalette();
  const [query, setQuery] = useState('');

  const mastery = useMemo(() => studentMastery(state), [state]);
  const students = state.students.filter((student: Student) =>
    `${student.name} ${student.roll} ${student.className}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  return (
    <>
      <PageHead
        eyebrow="Assigned classes only"
        title="Students & evidence"
        subtitle="Review evidence and progress without permanent ability labels.">
        <AppButton title="Import roster" onPress={() => open('import-students')} />
        <AppButton
          variant="primary"
          icon="＋"
          title="Add student"
          onPress={() => open('student')}
        />
      </PageHead>

      <Card>
        <CardHead eyebrow="Class 6A · Mathematics" title="Student roster">
          <TextInput
            style={[s.compactInput, { minWidth: 190 }]}
            placeholder="Search name or roll number"
            placeholderTextColor={p.muted}
            accessibilityLabel="Search name or roll number"
            value={query}
            onChangeText={setQuery}
          />
        </CardHead>

        <View style={s.userTable}>
          {students.map((student: Student) => {
            const m = mastery[student.name];
            return (
              <Pressable
                key={student.id}
                role="button"
                accessibilityLabel={`${student.name}, ${student.roll}, view evidence`}
                onPress={() => open(`student-evidence:${student.id}`)}
                style={({ hovered, pressed }) => [
                  s.userRow,
                  s.studentRow,
                  (hovered || pressed) && s.studentRowHover,
                ]}>
                <View style={[s.avatar, s.userRowAvatar]}>
                  <Text style={s.avatarText}>{initialsOf(student.name)}</Text>
                </View>
                <View style={s.userRowIdentity}>
                  <Text style={s.userRowName}>{student.name}</Text>
                  <Text style={s.userRowCaption}>
                    {student.roll} · {student.className}
                  </Text>
                </View>
                <View style={s.userRowCell}>
                  <Text style={s.userRowCaption}>
                    {m ? `${m.mastery}% mastery` : 'No evidence yet'}
                  </Text>
                </View>
                <View style={s.userRowCell}>
                  <StatusPill tone="success">{student.status}</StatusPill>
                </View>
                <View style={s.userRowActions}>
                  <Text style={s.listItemAction}>View evidence →</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </Card>
    </>
  );
}
