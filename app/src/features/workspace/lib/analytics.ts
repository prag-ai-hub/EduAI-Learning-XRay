/**
 * Every number the workspace shows about learning, derived from graded results.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx:180-248. The comment that
 * headed `allGradeResults` there is the rule for this whole module: Students,
 * Reports, Interventions and the dashboards read from here, never from
 * hardcoded demo numbers.
 *
 * Pure functions over `DemoState` - no hooks, no network, no platform module -
 * so a screen, a background export and a test can all call them.
 */

import type {
  ClassSubjectOption,
  DemoState,
  GradeResult,
} from '@/shared/types/workspace';

/** Every graded answer sheet across every assessment, flattened. */
export function allGradeResults(state: DemoState): GradeResult[] {
  return state.assessments.flatMap((a) => Object.values(a.gradeResults || {}));
}

/**
 * The class/subject pairs the analysis pickers offer.
 *
 * Two sources are merged: the roster's `classes` strings, which carry a student
 * strength, and the assessments themselves, which may name a pair the roster
 * has not been updated with. Roster entries win, because only they know the
 * strength.
 *
 * The split pattern is `/Â·|·/` verbatim from the web app: some rows were
 * written when the separator had been double-encoded, so both spellings of the
 * middot have to be accepted or those classes vanish from the picker.
 */
export function classSubjectOptions(state: DemoState): ClassSubjectOption[] {
  const options = new Map<string, ClassSubjectOption>();
  state.classes.forEach((entry) => {
    const parts = entry.split(/Â·|·/).map((part) => part.trim());
    const match = parts[0]?.match(/^(?:Class|Grade)\s+(.+?)([A-Za-z]+)$/i);
    if (!match || !parts[1]) return;
    const grade = match[1].trim(),
      section = match[2].toUpperCase(),
      subject = parts[1];
    const key = `${grade}|${section}|${subject.toLowerCase()}`;
    options.set(key, {
      key,
      classKey: `${grade}|${section}`,
      grade,
      section,
      subject,
      studentStrength: Number(parts[2]?.match(/\d+/)?.[0] || 0),
    });
  });
  state.assessments.forEach((a) => {
    if (!a.grade || !a.section || !a.subject) return;
    const section = a.section.toUpperCase(),
      key = `${a.grade}|${section}|${a.subject.toLowerCase()}`;
    if (!options.has(key))
      options.set(key, {
        key,
        classKey: `${a.grade}|${section}`,
        grade: a.grade,
        section,
        subject: a.subject,
        studentStrength: 0,
      });
  });
  return Array.from(options.values()).sort(
    (a, b) =>
      a.grade.localeCompare(b.grade, undefined, { numeric: true }) ||
      a.section.localeCompare(b.section) ||
      a.subject.localeCompare(b.subject),
  );
}

/**
 * Mastery per student, keyed by name.
 *
 * A result with concept gaps averages them; a result with none falls back to
 * the raw score percentage, which is what keeps a fully correct answer sheet
 * from reading as 0% mastery.
 */
export function studentMastery(
  state: DemoState,
): Record<string, { mastery: number; evidence: number; lastDate: string }> {
  const results = allGradeResults(state);
  const byStudent: Record<string, { sum: number; count: number; lastDate: string }> = {};
  results.forEach((r) => {
    const avgGap = r.gaps.length
      ? r.gaps.reduce((s, g) => s + g.mastery, 0) / r.gaps.length
      : (r.score / Math.max(1, r.maxMarks)) * 100;
    const bucket = byStudent[r.studentName] || { sum: 0, count: 0, lastDate: r.date };
    bucket.sum += avgGap;
    bucket.count += 1;
    if (r.date > bucket.lastDate) bucket.lastDate = r.date;
    byStudent[r.studentName] = bucket;
  });
  const out: Record<string, { mastery: number; evidence: number; lastDate: string }> = {};
  Object.entries(byStudent).forEach(([name, b]) => {
    out[name] = { mastery: Math.round(b.sum / b.count), evidence: b.count, lastDate: b.lastDate };
  });
  return out;
}

/** Mastery per concept across every result, weakest first. */
export function conceptMastery(
  state: DemoState,
): { concept: string; mastery: number; evidence: number }[] {
  const results = allGradeResults(state);
  const byConcept: Record<string, { sum: number; count: number }> = {};
  results.forEach((r) =>
    r.gaps.forEach((g) => {
      const bucket = byConcept[g.concept] || { sum: 0, count: 0 };
      bucket.sum += g.mastery;
      bucket.count += 1;
      byConcept[g.concept] = bucket;
    }),
  );
  return Object.entries(byConcept)
    .map(([concept, b]) => ({ concept, mastery: Math.round(b.sum / b.count), evidence: b.count }))
    .sort((a, b) => a.mastery - b.mastery);
}

/** One headline number, or null when nothing has been graded yet. */
export function overallMastery(state: DemoState): number | null {
  const concepts = conceptMastery(state);
  if (!concepts.length) return null;
  return Math.round(concepts.reduce((s, c) => s + c.mastery, 0) / concepts.length);
}

/** Mastery by calendar month, oldest first - the Reports chart. */
export function masteryTrend(state: DemoState): { label: string; value: number }[] {
  const results = allGradeResults(state)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  const byMonth: Record<string, { sum: number; count: number }> = {};
  results.forEach((r) => {
    const avgGap = r.gaps.length
      ? r.gaps.reduce((s, g) => s + g.mastery, 0) / r.gaps.length
      : (r.score / Math.max(1, r.maxMarks)) * 100;
    const month = r.date.slice(0, 7);
    const bucket = byMonth[month] || { sum: 0, count: 0 };
    bucket.sum += avgGap;
    bucket.count += 1;
    byMonth[month] = bucket;
  });
  return Object.entries(byMonth).map(([label, b]) => ({
    label,
    value: Math.round(b.sum / b.count),
  }));
}

/**
 * Record one or more provider round trips in the workspace's API log.
 *
 * The parameter is the narrow `setState` shape rather than React's `Dispatch`
 * so a caller holding either can pass it; the log is capped at 200 entries
 * because the whole `DemoState` is what gets PUT to /api/workspace.
 */
export function logApiTiming(
  setState: (fn: (s: DemoState) => DemoState) => void,
  timing?: { provider: 'mistral' | 'openai'; ms: number; ok: boolean }[],
): void {
  if (!timing || !timing.length) return;
  setState((s) => ({
    ...s,
    apiLog: [...timing.map((t) => ({ ...t, ts: Date.now() })), ...(s.apiLog || [])].slice(0, 200),
  }));
}

// ---------------------------------------------------------------------------
// Mastery bucketing
// ---------------------------------------------------------------------------

/** What a mastery percentage means, in the four forms the UI needs it. */
export type MasteryTone = {
  /** Matches `Gap.severity`, so a gap that carries its own severity can win. */
  severity: 'priority' | 'developing' | 'secure';
  /** Title case, as the report tables print it. */
  label: 'Priority' | 'Developing' | 'Secure';
  /** The `.status` pill modifier - see `StatusPill` in @/shared/components/status. */
  tone: 'warning' | 'success' | 'neutral';
};

/**
 * The <55 / <80 bucketing that the web app spelled out at six call sites
 * (FunctionalEduAIApp.tsx:1403, 1410 and the two report bodies at 1906, plus
 * the gap cards and the student-gaps dialog).
 *
 * Extracted because those six had begun to drift: two of them wrote
 * "Priority"/"Developing"/"Secure" and the others lower-cased severities, and
 * only the PDF carried the colours. One function, three shapes, one threshold.
 * The thresholds themselves are unchanged.
 */
export function masteryTone(mastery: number): MasteryTone {
  const value = Number(mastery) || 0;
  if (value < 55) return { severity: 'priority', label: 'Priority', tone: 'warning' };
  if (value < 80) return { severity: 'developing', label: 'Developing', tone: 'neutral' };
  return { severity: 'secure', label: 'Secure', tone: 'success' };
}

/**
 * The severity a GAP CARD may show, which is not the same set.
 *
 * `masteryTone` has three bands because a report does; the diagnostic gap list
 * has two. The source renders `{g.severity || (g.mastery < 55 ? 'priority' :
 * 'developing')}` - a two-way fallback with no secure branch, because a gap
 * that has been closed is not listed as a gap at all. Reusing `masteryTone`
 * there would start captioning an 85%-mastery gap "secure learning gap",
 * which reads as a contradiction and is not something the web app ever said.
 */
export function gapSeverity(gap: { severity?: string; mastery: number }): string {
  return gap.severity || (Number(gap.mastery) < 55 ? 'priority' : 'developing');
}
