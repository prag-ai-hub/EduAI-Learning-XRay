/**
 * The shared prop surface.
 *
 * Almost every component in the ported workspace is handed some subset of the
 * same values and callbacks. Declaring them once and picking per component
 * keeps each signature honest and each callback defined in exactly one place -
 * change `Notify` here and every consumer is checked against it.
 *
 * Split out of `./workspace` only because that file is the domain model and
 * this one is the component contract; both are re-exported from
 * `@/shared/types/workspace`, which is the import consumers should use.
 */

import type { Dispatch, SetStateAction } from 'react';

import type { AdminModule, Assessment, DemoProfile, DemoState, TeacherModule } from './workspace';

// ---------------------------------------------------------------------------
// The dialog protocol
// ---------------------------------------------------------------------------

/**
 * Every dialog the registry can render.
 *
 * In the Next.js app this was a bare `string`, and the registry
 * (FunctionalEduAIApp.tsx:887) matched it against ~52 literals. Around 25 call
 * sites pass a literal, so a typo produced a modal with a close button and
 * nothing in it, at runtime, with no warning. Naming the union moves that to
 * compile time.
 */
export type DialogName =
  | 'academic-year'
  | 'activity'
  | 'appearance-settings'
  | 'approval'
  | 'bulk-analysis'
  | 'bulk-review'
  | 'class'
  | 'consent-settings'
  | 'create-assessment'
  | 'credits-user'
  | 'delete-assessment'
  | 'diagnose-file'
  | 'diagnose-picker'
  | 'edit-user'
  | 'evidence'
  | 'followup'
  | 'grade-file'
  | 'grade-picker'
  | 'grading-settings'
  | 'group'
  | 'import-students'
  | 'intervention-form'
  | 'invite'
  | 'notification-settings'
  | 'notifications'
  | 'parent-share'
  | 'platform-config'
  | 'privacy-settings'
  | 'process'
  | 'profile'
  | 'publish'
  | 'quality'
  | 'regrade'
  | 'report'
  | 'report-settings'
  | 'reset-user'
  | 'review-help'
  | 'school'
  | 'security-settings'
  | 'setup'
  | 'share-report'
  | 'student'
  | 'student-evidence'
  | 'student-gaps'
  | 'study-guide'
  | 'support-access'
  | 'upload'
  | 'worksheet'
  | 'worksheet-edit'
  | 'worksheet-gap'
  | 'worksheet-grade'
  | 'xray-details';

/**
 * The dialogs that address a row. The registry splits the type on the first
 * ":" - `const title = type.split(":")[0]`, `const id = type.split(":").slice(1).join(":")` -
 * so the id may itself contain colons, which `evidence` and `group` rely on:
 * they pack two URI-encoded values into it.
 */
export type DialogWithId =
  | 'credits-user'
  | 'diagnose-file'
  | 'edit-user'
  | 'evidence'
  | 'followup'
  | 'grade-file'
  | 'group'
  | 'parent-share'
  | 'reset-user'
  | 'student-evidence'
  | 'student-gaps'
  | 'study-guide'
  | 'worksheet'
  | 'worksheet-edit'
  | 'worksheet-gap'
  | 'worksheet-grade';

/**
 * What `open()` accepts: a dialog name, optionally followed by ":" and an id.
 *
 * Every id-carrying name is also valid bare, which matches the registry - it
 * looks the id up with `find`, and renders the dialog's empty state when it
 * finds nothing.
 */
export type DialogType = DialogName | `${DialogWithId}:${string}`;

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

/** The three toast tones. Anything else falls through to the success styling. */
export type ToastKind = 'success' | 'warning' | 'error';

/** Raise a toast. Defaults to "success" when no kind is given. */
export type Notify = (text: string, kind?: ToastKind) => void;

export type OpenDialog = (type: DialogType) => void;

export type UpdateAssessment = (id: string, patch: Partial<Assessment>) => void;

export type SetWorkspace = Dispatch<SetStateAction<DemoState>>;

/** Select an assessment, and optionally move to a module while doing it. */
export type OpenAssessment = (id: string, next?: TeacherModule) => void;

/** Some dialogs choose their own toast text instead of the parent choosing it. */
export type DoneWithMessage = (message: string) => void;

// ---------------------------------------------------------------------------
// The prop bag
// ---------------------------------------------------------------------------

export type WorkspaceProps = {
  profile: DemoProfile;
  module: TeacherModule | AdminModule;
  state: DemoState;
  setState: SetWorkspace;
  selected: Assessment;
  assessment: Assessment;
  update: UpdateAssessment;
  open: OpenDialog;
  close: () => void;
  /** Dialogs close themselves through this; the parent supplies the toast. */
  done: () => void;
  notify: Notify;
  openAssessment: OpenAssessment;
  resetDemo: () => void;
};

/** `W<"state"|"notify">` - the per-component pick every signature is built from. */
export type W<K extends keyof WorkspaceProps> = Pick<WorkspaceProps, K>;
