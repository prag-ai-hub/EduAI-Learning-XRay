/**
 * The workspace's seed data and its small vocabulary of labels.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx: the role canonicaliser
 * (32-37), the upload policy (135-137), `initialState` and its companions
 * (139-179), and the eight label/format helpers scattered around 1715-1730.
 *
 * Nothing here touches the network, the DOM or a platform module. It is the
 * layer every screen reads before it has any evidence of its own, so it has to
 * be importable from a route file, a hook and a background task alike.
 */

import type {
  DemoProfile,
  DemoState,
  Role,
  Stage,
  TeacherModule,
  UploadFile,
} from '@/shared/types/workspace';

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

/** The four M7 roles. Anything else is a legacy label and becomes a Teacher. */
export const CANONICAL_ROLES = ['SuperAdmin', 'SchoolAdmin', 'Teacher', 'Parent'];

/**
 * Whatever the profile row says, as a role the app can switch on.
 *
 * "Admin" was the pre-M7 spelling of SchoolAdmin and is still in older rows, so
 * it is translated rather than defaulted.
 */
export function toRole(value: unknown): Role {
  const role = String(value || '');
  if (role === 'Admin') return 'SchoolAdmin'; // pre-M7 value
  return (CANONICAL_ROLES.includes(role) ? role : 'Teacher') as Role;
}

// ---------------------------------------------------------------------------
// The upload policy
// ---------------------------------------------------------------------------

/**
 * The `accept` list. On web this is still handed to a file input verbatim; on
 * native the document picker takes MIME types instead, so `file-picker.tsx`
 * translates it. Kept as the one string both sides derive from.
 */
export const DOCUMENT_ACCEPT =
  '.pdf,.jpg,.jpeg,.png,.heic,.docx,.odt,.md,.markdown,.txt,.rtf,.html,.htm,.xml,.json,.yaml,.yml,.csv,.tsv,.xlsx,.xls,text/*';

export const DOCUMENT_EXTENSIONS = new Set([
  'pdf',
  'jpg',
  'jpeg',
  'png',
  'heic',
  'docx',
  'odt',
  'md',
  'markdown',
  'txt',
  'rtf',
  'html',
  'htm',
  'xml',
  'json',
  'yaml',
  'yml',
  'csv',
  'tsv',
  'xlsx',
  'xls',
]);

/**
 * Whether a picked document may be uploaded at all.
 *
 * The web took a DOM `File`. A native picker returns a plain object with the
 * same two fields and no `File` class exists on Hermes, so the parameter is
 * structural - a browser `File` still satisfies it - and `type` is optional
 * because expo-document-picker omits it for some providers.
 */
export function supportsDocumentUpload(file: { name: string; type?: string | null }): boolean {
  return (
    String(file.type || '').startsWith('text/') ||
    DOCUMENT_EXTENSIONS.has(file.name.toLowerCase().split('.').pop() || '')
  );
}

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

/**
 * The demonstration workspace. A signed-in teacher never sees it - they get
 * `newTeacherState` - but it is what an unrestored workspace renders while the
 * bootstrap fetch is in flight, and what "Restore demo data" puts back.
 */
export const initialState: DemoState = {
  assessments: [
    {
      id: 'a1',
      title: 'Fractions checkpoint',
      type: 'Quiz',
      grade: '6',
      section: 'A',
      subject: 'Mathematics',
      maxMarks: 20,
      date: '2026-07-21',
      stage: 'review',
      files: [
        {
          id: 'f0',
          name: 'Grade6A_Fractions_QuestionPaper.pdf',
          type: 'application/pdf',
          size: 1120000,
          progress: 100,
          status: 'OCR complete',
        },
        {
          id: 'f1',
          name: 'Grade6A_Fractions_MiraBose.pdf',
          type: 'application/pdf',
          size: 2450000,
          progress: 100,
          status: 'OCR complete',
        },
      ],
      questions: 8,
      reviewed: 25,
      totalReviews: 28,
      quality: 78,
      published: false,
      version: 1,
    },
    {
      id: 'a2',
      title: 'Decimals exit ticket',
      type: 'Exit ticket',
      grade: '6',
      section: 'B',
      subject: 'Mathematics',
      maxMarks: 10,
      date: '2026-07-19',
      stage: 'published',
      files: [],
      questions: 5,
      reviewed: 30,
      totalReviews: 30,
      quality: 86,
      published: true,
      version: 1,
    },
  ],
  users: [
    {
      id: 'u1',
      name: 'Asha Sharma',
      email: 'asha@sunrise.edu',
      role: 'Teacher',
      school: 'Sunrise Academy',
      phone: '+91 98765 43210',
      status: 'Active',
    },
    {
      id: 'u2',
      name: 'Rohan Mehta',
      email: 'rohan@sunrise.edu',
      role: 'Principal',
      school: 'Sunrise Academy',
      phone: '+91 98765 43211',
      status: 'Active',
    },
    {
      id: 'u3',
      name: 'Priya Nair',
      email: 'priya@sunrise.edu',
      role: 'Teacher',
      school: 'Sunrise Academy',
      phone: '+91 98765 43212',
      status: 'Inactive',
    },
  ],
  interventions: [
    {
      id: 'i1',
      assessmentId: 'a2',
      concept: 'Decimal place value',
      format: 'Guided practice',
      duration: '15 minutes',
      status: 'In progress',
      followup: '2026-07-26',
    },
  ],
  classes: [
    'Class 6A · Mathematics · 28 students',
    'Class 6B · Mathematics · 30 students',
    'Class 7A · Mathematics · 32 students',
  ],
  schools: ['Sunrise Academy · Mumbai · CBSE'],
  students: [
    { id: 's1', name: 'Mira Bose', roll: '6A-12', className: 'Class 6A', status: 'Active' },
    { id: 's2', name: 'Kabir Shah', roll: '6A-14', className: 'Class 6A', status: 'Active' },
    { id: 's3', name: 'Riya Menon', roll: '6A-18', className: 'Class 6A', status: 'Active' },
    { id: 's4', name: 'Aarav Kapoor', roll: '6A-21', className: 'Class 6A', status: 'Active' },
  ],
  resources: [
    {
      id: 'r1',
      title: 'Unlike Fractions Recovery Practice',
      type: 'Guided worksheet',
      status: 'Approved',
      template: 'Guided recovery',
      concept: 'Add fractions with unlike denominators',
      mcq: 6,
      subjective: 4,
      answerSheets: 6,
      gradedSheets: 4,
    },
    {
      id: 'r2',
      title: 'Decimal place-value exit ticket',
      type: 'Exit ticket',
      status: 'Draft',
      template: 'Quick check',
      concept: 'Decimal place value',
      mcq: 4,
      subjective: 2,
      answerSheets: 0,
      gradedSheets: 0,
    },
  ],
  academicYears: ['2026–27 · Active', '2025–26 · Archived'],
  events: ['Demo workspace created'],
  apiLog: [],
};

/**
 * The stage vocabulary, in cycle order.
 *
 * The order of these keys is load-bearing: `stageProgress` indexes its
 * percentage table by `Object.keys(stageLabel).indexOf(stage)`, and the journey
 * strip decides "done" from the same index. Reordering them renumbers the
 * workflow.
 */
export const stageLabel: Record<Stage, string> = {
  draft: 'Draft',
  uploaded: 'Uploaded',
  setup: 'Rubric setup',
  grading: 'AI grading',
  review: 'Teacher review',
  approved: 'Approved',
  xray: 'X-Ray ready',
  intervention: 'Intervention',
  followup: 'Follow-up',
  published: 'Published',
};

export const teacherNav: TeacherModule[] = [
  'Home',
  'Work',
  'Review',
  'X-Ray',
  'Interventions',
  'Students',
  'Resources',
  'Achievements',
  'Reports',
  'Settings',
];

/** A fresh deep copy. Callers mutate their state freely, so it must not alias. */
export function cloneInitial(): DemoState {
  return JSON.parse(JSON.stringify(initialState)) as DemoState;
}

/** The empty workspace a real teacher starts from: their own row, nothing else. */
export function newTeacherState(profile: DemoProfile): DemoState {
  const state = cloneInitial();
  return {
    ...state,
    assessments: [],
    interventions: [],
    resources: [],
    events: [`Teacher workspace created · ${profile.name}`],
    users: [
      {
        id: profile.id,
        name: profile.name,
        email: profile.email,
        role: 'Teacher',
        school: profile.school,
        phone: '',
        status: 'Active',
      },
    ],
    schools: [`${profile.school} · Teacher workspace`],
  };
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** The sidebar glyph for a module. Anything unlisted gets the settings cog. */
export function icon(x: string): string {
  return (
    (
      {
        Home: '⌂',
        Work: '▣',
        Review: '✓',
        'X-Ray': '✦',
        Interventions: '↗',
        Reports: '▥',
        Overview: '⌂',
        Users: '♙',
        'Schools & Classes': '▦',
        Billing: '₹',
      } as Record<string, string>
    )[x] || '⚙'
  );
}

/** How far through the cycle a stage sits, as a percentage for `<Progress>`.
 *
 * `indexOf` is -1 for a stage that is not in `stageLabel`, which indexed the
 * array to `undefined` behind a `number` return type - and `<Progress value>`
 * would then have rendered "undefined%" with nothing failing first. Zero is the
 * honest answer for a stage the cycle does not know. */
export function stageProgress(stage: Stage): number {
  const index = Object.keys(stageLabel).indexOf(stage);
  if (index < 0) return 0;
  return [10, 25, 38, 50, 62, 72, 80, 88, 95, 100][index] ?? 0;
}

/** The single call to action a card shows for an assessment at this stage. */
export function nextAction(stage: Stage): string {
  return (
    {
      draft: 'Upload work',
      uploaded: 'Set up rubric',
      setup: 'Start grading',
      grading: 'View processing',
      review: 'Review answers',
      approved: 'Generate X-Ray',
      xray: 'Plan intervention',
      intervention: 'Record follow-up',
      followup: 'Publish grades',
      published: 'View report',
    } as Record<Stage, string>
  )[stage];
}

/** "worksheet-edit" -> "Worksheet Edit". The registry's fallback dialog title. */
export function dialogTitle(x: string): string {
  return x
    .split('-')
    .map((v) => v[0]?.toUpperCase() + v.slice(1))
    .join(' ');
}

/** The heading each Reports tab renders, or the tab's own name for one this
 *  map does not list. Typed `string` while returning `undefined` meant a
 *  caller got no warning and the heading silently disappeared. */
export function reportTitle(tab: string): string {
  return (
    {
      'Student performance': 'Class 6 performance trend',
      'Performance matrix report': 'Class 6A performance matrix',
      'Concept mastery': 'Mastery by concept',
      'Learning gaps': 'Priority learning gaps',
      'Teacher summary': 'Teacher-approved activity summary',
      'School dashboard': 'School improvement overview',
    } as Record<string, string>
  )[tab] ?? tab;
}

/**
 * A student name guessed from the file name, so a bulk upload does not ask the
 * teacher to type twenty of them.
 *
 * Note the fallback: when the name yields nothing usable it picks a RANDOM
 * student from the roster rather than an empty string. That is what the web app
 * did, so it is what this does; it is also why the teacher always confirms the
 * name before grading.
 */
export function guessStudentName(file: UploadFile, students: { name: string }[]): string {
  const base = file.name
    .replace(/\.[^.]+$/, '')
    .replace(/[_\-]+/g, ' ')
    .replace(/\b(answer|sheet|paper|qp|question|scan|img|copy|final|v\d+)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (base.length > 2)
    return base
      .split(' ')
      .filter(Boolean)
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(' ');
  return students[Math.floor(Math.random() * students.length)]?.name || 'Student';
}

/**
 * A short, stable id derived from a string - the djb2-ish hash the web app used
 * for generated worksheet and study-guide ids.
 *
 * Stable is the point: regenerating a resource from the same evidence must
 * address the same row rather than pile up duplicates.
 */
export function stableKey(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  return Math.abs(hash).toString(36);
}
