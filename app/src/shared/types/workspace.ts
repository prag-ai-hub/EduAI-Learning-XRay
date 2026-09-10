/**
 * The workspace domain model.
 *
 * Ported verbatim from the single-line type block at the head of
 * frontend/app/ui/FunctionalEduAIApp.tsx (lines 31-136), plus `DirectorySchool`
 * from the school-directory section (~768) and `PdfJsModule` (~123). Nothing
 * here is new; it is the same shapes, spread out so they can be read.
 *
 * Every wave of the screen port reads these, so this module is deliberately
 * free of imports and free of runtime code - it must never pull a platform
 * module into a bundle that only wanted a type.
 *
 * The prop surface every component signature is built from (`WorkspaceProps`,
 * `W<K>`, the callback aliases and `DialogType`) lives in `./workspace-props`
 * and is re-exported at the bottom, so `@/shared/types/workspace` remains the
 * one import every consumer needs.
 */

// ---------------------------------------------------------------------------
// Identity and navigation
// ---------------------------------------------------------------------------

/**
 * Canonical roles are the four M7 values. The trailing strings are legacy
 * demo-only labels still referenced by the unreachable Principal/Platform
 * views, and are kept so those screens still typecheck as they port.
 */
export type Role =
  | 'SuperAdmin'
  | 'SchoolAdmin'
  | 'Teacher'
  | 'Parent'
  | 'Principal'
  | 'School admin'
  | 'Platform admin';

export type TeacherModule =
  | 'Home'
  | 'Work'
  | 'Review'
  | 'X-Ray'
  | 'Interventions'
  | 'Students'
  | 'Resources'
  | 'Achievements'
  | 'Reports'
  | 'Settings';

export type AdminModule =
  | 'Overview'
  | 'Users'
  | 'Schools & Classes'
  | 'Students'
  | 'Academic years'
  | 'Branding & Privacy'
  | 'Schools'
  | 'Analytics'
  | 'AI Configuration'
  | 'Feature flags'
  | 'System health'
  | 'Audit'
  | 'Reports';

/** Where an assessment sits in the evidence -> insight -> action cycle. */
export type Stage =
  | 'draft'
  | 'uploaded'
  | 'setup'
  | 'grading'
  | 'review'
  | 'approved'
  | 'xray'
  | 'intervention'
  | 'followup'
  | 'published';

// ---------------------------------------------------------------------------
// Grading evidence
// ---------------------------------------------------------------------------

/** One concept the evidence says a student has not secured. */
export type Gap = {
  concept: string;
  mastery: number;
  finding?: string;
  misconception?: string;
  evidence?: string;
  prerequisiteConcept?: string;
  foundationGap?: string;
  recommendedLevel?: string;
  remediationSequence?: string[];
  rework?: string;
  severity?: 'priority' | 'developing' | 'secure';
};

/**
 * One question as the evaluator returns it, plus the teacher's decision on it.
 * `awardedMarks` is the teacher's final figure; `aiAwardedMarks` preserves what
 * the model proposed so an override is visible and auditable.
 */
export type EvaluatorQuestion = {
  id: string;
  label: string;
  attemptState: 'attempted' | 'not_attempted' | 'excluded';
  awardedMarks: number;
  aiAwardedMarks?: number;
  maxMarks: number;
  allowedIncrement: number;
  evidence: string;
  rationale: string;
  confidence: number;
  aiDisposition: 'accepted' | 'edited' | 'rejected';
  reviewed: boolean;
  teacherComment?: string;
  pageNumber?: number;
  criteria?: {
    id: string;
    label: string;
    awardedMarks: number;
    maxMarks: number;
    evidence?: string;
    rationale?: string;
  }[];
};

/** The analysis of one answer sheet, keyed in `Assessment.gradeResults` by file id. */
export type GradeResult = {
  published?: boolean;
  questionCount?: number;
  fileId: string;
  studentName: string;
  questionPaperFileId?: string;
  questionPaperName?: string;
  score: number;
  maxMarks: number;
  gaps: Gap[];
  date: string;
  feedback?: string;
  ocrText?: string;
  evidenceFingerprint?: string;
  reanalysisReason?: string;
  evaluationVersionId?: string;
  evaluationVersion?: number;
  evaluationStatus?: 'submitted' | 'moderation_pending' | 'finalized' | 'published';
  questionDecisions?: EvaluatorQuestion[];
  gradingSkipped?: boolean;
};

export type Assessment = {
  id: string;
  title: string;
  type: string;
  grade: string;
  section: string;
  subject: string;
  maxMarks: number;
  date: string;
  stage: Stage;
  files: UploadFile[];
  questions: number;
  reviewed: number;
  totalReviews: number;
  quality: number;
  published: boolean;
  version: number;
  gradedFileIds?: string[];
  lastGradedFileId?: string;
  gradeResults?: Record<string, GradeResult>;
  answerKey?: string;
  rubric?: string;
};

// ---------------------------------------------------------------------------
// Uploaded evidence
// ---------------------------------------------------------------------------

/** How a teacher classifies an uploaded document, which decides what may be run on it. */
export type DocumentRole =
  | 'Question paper'
  | 'Marking scheme'
  | 'Model answer'
  | 'Ungraded answer sheet'
  | 'Teacher-graded answer sheet'
  | 'Supporting reference';

/**
 * A file attached to an assessment. The bytes are not here - they live in the
 * blob store under `id`, reached through `@/shared/files`. `preview` is a
 * renderable URI, so whoever sets it owns releasing it.
 */
export type UploadFile = {
  id: string;
  name: string;
  type: string;
  size: number;
  progress: number;
  status: string;
  preview?: string;
  documentRole?: DocumentRole;
};

/** Which document an OCR pass produced text for. */
export type OcrDocumentRole = 'answerSheet' | 'questionPaper' | 'markingScheme' | 'modelAnswer';

/** OCR text per document role, held for teacher validation before analysis. */
export type OcrDocument = { name?: string; text: string };

export type OcrDocuments = Partial<Record<OcrDocumentRole, OcrDocument>>;

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  school: string;
  phone: string;
  status: 'Active' | 'Inactive' | 'Invited';
  totalCredits?: number;
  usedCredits?: number;
};

/** The signed-in teacher, as the workspace shell holds them. */
export type DemoProfile = {
  id: string;
  name: string;
  email: string;
  role: Role;
  school: string;
  label: string;
};

export type CreditSummary = { total: number; used: number; remaining: number };

/** A row of GET /api/admin/users, before it is mapped onto the local User type. */
export type ApiUserRow = {
  id: string;
  name?: string | null;
  email: string;
  role?: string;
  status?: string;
  total_credits?: number;
  used_credits?: number;
};

// ---------------------------------------------------------------------------
// Intervention and practice
// ---------------------------------------------------------------------------

export type Intervention = {
  id: string;
  assessmentId: string;
  concept: string;
  format: string;
  duration: string;
  status: string;
  followup: string;
  followupRecorded?: boolean;
  followupEvidence?: {
    studentsCompleted: number;
    avgMastery: number;
    outcome: string;
    note: string;
  };
};

export type CognitiveLevel = 'recall' | 'application' | 'analysis';

export type WorksheetContent = {
  mcqQuestions: {
    question: string;
    options: string[];
    correctIndex: number;
    cognitiveLevel: CognitiveLevel;
    concept?: string;
  }[];
  subjectiveQuestions: {
    question: string;
    modelAnswer: string;
    cognitiveLevel: CognitiveLevel;
    concept?: string;
  }[];
};

/** A generated practice resource. Also the carrier for a saved study guide. */
export type Worksheet = {
  published?: boolean;
  id: string;
  title: string;
  type: string;
  status: string;
  template?: string;
  concept?: string;
  concepts?: string[];
  subject?: string;
  grade?: string;
  assessmentId?: string;
  mcq?: number;
  subjective?: number;
  difficulty?: string;
  answerSheets?: number;
  gradedSheets?: number;
  content?: WorksheetContent;
  guide?: StudyGuide;
  studentName?: string;
  evidenceFiles?: string[];
};

/** A generated study guide, as /api/generate-study-guide returns it. */
export type StudyGuideTopic = {
  concept: string;
  mastery?: number;
  diagnosis?: string;
  learningObjective?: string;
  explanation?: string;
  workedExample?: string;
  practiceSteps?: string[];
  checkForUnderstanding?: string[];
};

export type StudyGuide = {
  id?: string;
  title: string;
  subject?: string;
  grade?: string;
  studentName?: string;
  overview?: string;
  evidenceFiles?: string[];
  topics?: StudyGuideTopic[];
};

/**
 * The fields a downloadable worksheet needs. A Worksheet satisfies it, and so
 * does the literal WorksheetDialog builds for an unsaved preview.
 */
export type WorksheetDocumentMeta = {
  title?: string;
  template?: string;
  concept?: string;
  concepts?: string[];
  subject?: string;
  grade?: string;
  difficulty?: string;
  content?: WorksheetContent;
};

/**
 * The header fields a downloadable study guide needs. Both a Worksheet and the
 * literal built in StudyGuideDialog satisfy it.
 */
export type StudyGuideDocumentMeta = {
  title?: string;
  subject?: string;
  grade?: string;
  studentName?: string;
  evidenceFiles?: string[];
};

// ---------------------------------------------------------------------------
// The workspace snapshot
// ---------------------------------------------------------------------------

/** One AI provider round trip, kept for the latency panel. */
export type ApiLogEntry = { provider: 'mistral' | 'openai'; ms: number; ok: boolean; ts: number };

/**
 * The whole workspace, as one JSON document. This is what GET/PUT /api/workspace
 * moves and what the offline cache holds, so its shape is a wire contract, not
 * just a local convenience.
 */
export type DemoState = {
  assessments: Assessment[];
  users: User[];
  interventions: Intervention[];
  classes: string[];
  schools: string[];
  students: { id: string; name: string; roll: string; className: string; status: string }[];
  resources: Worksheet[];
  academicYears: string[];
  events: string[];
  apiLog: ApiLogEntry[];
};

/** A roster entry. Structural, exactly as the monolith derived it. */
export type Student = DemoState['students'][number];

/** One class/subject pairing derived from the roster, for the analysis pickers. */
export type ClassSubjectOption = {
  key: string;
  classKey: string;
  grade: string;
  section: string;
  subject: string;
  studentStrength: number;
};

// ---------------------------------------------------------------------------
// Platform administration
// ---------------------------------------------------------------------------

/**
 * A school as the Django directory returns it. These are platform rows, served
 * by the backend rather than read out of the workspace snapshot, so the field
 * names are the API's snake_case and not the client's.
 */
export type DirectorySchool = {
  id: string;
  name: string;
  city: string | null;
  board: string | null;
  status: 'Pending' | 'Active' | 'Suspended' | 'Closed';
  created_at: string;
  approved_at: string | null;
  suspended_at: string | null;
  user_count?: number;
  student_count?: number;
};

// ---------------------------------------------------------------------------
// pdf.js
// ---------------------------------------------------------------------------

/**
 * Only the surface of pdf.js the corrected-answer-sheet export touches - it is
 * loaded from a CDN URL at runtime, so there are no package types to import.
 *
 * It renders into a DOM `<canvas>`, so it is reachable on web only; the native
 * branch of the documents wave degrades to a text-only corrected copy.
 */
export type PdfJsModule = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (options: { data: Uint8Array }) => {
    promise: Promise<{
      numPages: number;
      getPage: (page: number) => Promise<{
        getViewport: (options: { scale: number }) => { width: number; height: number };
        render: (options: {
          canvasContext: CanvasRenderingContext2D;
          viewport: unknown;
        }) => { promise: Promise<void> };
      }>;
    }>;
  };
};

// ---------------------------------------------------------------------------
// The shared prop surface
// ---------------------------------------------------------------------------

// Re-exported so every consumer has one import to remember. These are types
// only, so the cycle between the two modules is erased at compile time.
export type {
  DialogName,
  DialogType,
  DialogWithId,
  DoneWithMessage,
  Notify,
  OpenAssessment,
  OpenDialog,
  SetWorkspace,
  ToastKind,
  UpdateAssessment,
  W,
  WorkspaceProps,
} from './workspace-props';
