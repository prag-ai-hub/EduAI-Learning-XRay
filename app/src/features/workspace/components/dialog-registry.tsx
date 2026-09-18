/**
 * The workspace shell's switchboard: one `DialogType` in, one dialog out, inside
 * the shared modal frame.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx `AppDialog` (~887).
 *
 * ---------------------------------------------------------------------------
 * HOW A TYPE IS READ
 * ---------------------------------------------------------------------------
 * A type is a dialog name, optionally followed by ":" and an id - `grade-file:abc`.
 * It splits on the FIRST colon only, exactly as the monolith's
 * `type.split(":")[0]` / `type.split(":").slice(1).join(":")` did, because the
 * id may carry colons of its own: `parent-share` is opened with
 * `<assessmentId>:<fileId>`, and `evidence` and `group` pack two URI-encoded
 * values the same way. A bare name yields an empty id, and each dialog renders
 * its own "not found" state for that, as it did on the web.
 *
 * ---------------------------------------------------------------------------
 * DECISIONS
 * ---------------------------------------------------------------------------
 *  * **A switch, not ~52 `&&` lines.** The `default` branch is typed `never`, so
 *    a name added to `DialogName` without a dialog here is a compile error. On
 *    the web that mistake was an empty modal with only a close button. Every
 *    name in the union has a dialog today; nothing renders null by design.
 *
 *  * **The body is keyed by the full type.** The web gave every dialog its own
 *    JSX slot, so moving between two names - `approval` to `publish`, or one
 *    `SimpleSettings` screen to another - always remounted, and the per-file
 *    grading dialog was additionally keyed by file id so "grade the next sheet"
 *    started clean. A single switch would reuse the instance whenever two cases
 *    return the same component, carrying one screen's form values into the
 *    next. Keying on the whole type restores both behaviours at once, and also
 *    covers the one the web missed: `worksheet-edit:a` to `worksheet-edit:b`
 *    kept worksheet a's local state.
 *
 *  * **Assessment-scoped dialogs need an assessment.** The shell derives
 *    `selected` as "the chosen assessment, else the first", which is nothing at
 *    all for a school that has not created one. The web guarded only `upload`
 *    and `delete-assessment`; the rest read `selected.files` and threw. A throw
 *    on a device is a red screen rather than a console error, so every dialog
 *    that reads the assessment shows the empty frame instead.
 *
 *  * **Parents.** The web's parent area was a "coming soon" card; parents now
 *    have a real portal at the `/parent` route, which is not a dialog. What
 *    stays here is the teacher's side: `parent-share`, which mints the link.
 */

import { Fragment, type ReactNode } from 'react';

import { RosterImport } from '@/features/admin/components/roster-import';
import {
  AcademicYearDialog,
  ClassDialog,
  SchoolDialog,
} from '@/features/admin/components/school-structure';
import { StudentDialog, StudentEvidence } from '@/features/admin/components/student-dialogs';
import { CreditAllocationDialog, InviteDialog, UserEdit } from '@/features/admin/components/users';
import { BulkAnalysisWizard } from '@/features/assessments/components/bulk-analysis';
import { CreateAssessment } from '@/features/assessments/components/create-assessment';
import { DeleteAssessmentDialog } from '@/features/assessments/components/delete-assessment';
import {
  DiagnosisSelectionDialog,
  GradeSelectionDialog,
} from '@/features/assessments/components/grade-selection';
import {
  BulkReview,
  ProcessDialog,
  RegradeDialog,
  SetupDialog,
} from '@/features/assessments/components/setup';
import { StudentGapsDialog } from '@/features/assessments/components/student-gaps';
import { UploadDialogV2 } from '@/features/assessments/components/upload';
import { StudyGuideDialog } from '@/features/documents/components/study-guide';
import { WorksheetDialog } from '@/features/documents/components/worksheet-dialog';
import { WorksheetGradingDialog } from '@/features/documents/components/worksheet-grading';
import { PerFileGradeDialog } from '@/features/grading/components/per-file-grade';
import { EvidenceDialog, GroupDialog, QualityDialog } from '@/features/grading/components/quality';
import { ParentShareDialog } from '@/features/parent/components/parent-share';
import { ReportDialog, ShareDialog } from '@/features/share/components/share';
import { FollowupDialog, InterventionForm } from '@/features/teacher/components/intervention';
import {
  Activity,
  ConsentDialog,
  NotificationDialog,
  SecurityDialog,
} from '@/features/workspace/components/activity';
import { dialogTitle } from '@/features/workspace/lib/demo-state';
import { ConfirmDialog, ModalShell, SimpleSettings } from '@/shared/components/modal';
import type { DialogName, DialogType, W } from '@/shared/types/workspace';

/** The names whose dialog reads the selected assessment on its first render. */
const NEEDS_ASSESSMENT: ReadonlySet<DialogName> = new Set<DialogName>([
  'upload',
  'grade-picker',
  'diagnose-picker',
  'bulk-analysis',
  'grade-file',
  'diagnose-file',
  'delete-assessment',
  'student-gaps',
  'worksheet-gap',
  'setup',
  'process',
  'approval',
  'publish',
  'regrade',
  'bulk-review',
  'intervention-form',
  'study-guide',
  'quality',
]);

/** Split on the first colon only - see the header. */
function parseDialogType(type: DialogType): { name: DialogName; id: string } {
  const colon = type.indexOf(':');
  if (colon === -1) return { name: type as DialogName, id: '' };
  // The template-literal half of DialogType guarantees the prefix is a name.
  return { name: type.slice(0, colon) as DialogName, id: type.slice(colon + 1) };
}

type RegistryProps = W<
  | 'close'
  | 'open'
  | 'state'
  | 'setState'
  | 'selected'
  | 'update'
  | 'notify'
  | 'resetDemo'
  | 'openAssessment'
>;

export function AppDialog({
  type,
  close,
  open,
  state,
  setState,
  selected,
  update,
  notify,
  resetDemo,
  openAssessment,
}: W<
  | 'close'
  | 'open'
  | 'state'
  | 'setState'
  | 'selected'
  | 'update'
  | 'notify'
  | 'resetDemo'
  | 'openAssessment'
> & { type: DialogType }) {
  const { name, id } = parseDialogType(type);
  const done = (message: string) => {
    notify(message);
    close();
  };
  const props: RegistryProps = {
    close,
    open,
    state,
    setState,
    selected,
    update,
    notify,
    resetDemo,
    openAssessment,
  };

  return (
    <ModalShell label={dialogTitle(name)} onClose={close}>
      <Fragment key={type}>{renderDialog(name, id, props, done)}</Fragment>
    </ModalShell>
  );
}

function renderDialog(
  name: DialogName,
  id: string,
  {
    close,
    open,
    state,
    setState,
    selected,
    update,
    notify,
    resetDemo,
    openAssessment,
  }: RegistryProps,
  done: (message: string) => void,
): ReactNode {
  // `selected` is typed as always present; at runtime it is not - see the header.
  if (!selected && NEEDS_ASSESSMENT.has(name)) return null;

  const user = state.users.find((u) => u.id === id);

  switch (name) {
    /* ---- Assessment lifecycle ------------------------------------------- */
    case 'create-assessment':
      return (
        <CreateAssessment
          setState={setState}
          done={(createdId) => {
            openAssessment(createdId, 'Work');
            done('Assessment saved and added to Work');
          }}
        />
      );
    case 'upload':
      return (
        <UploadDialogV2
          assessment={selected}
          update={update}
          done={() => done('Evidence uploaded and classified. OCR is ready.')}
        />
      );
    case 'grade-picker':
      return <GradeSelectionDialog assessment={selected} open={open} />;
    case 'diagnose-picker':
      return <DiagnosisSelectionDialog assessment={selected} open={open} />;
    case 'bulk-analysis':
      return <BulkAnalysisWizard assessment={selected} open={open} done={done} />;
    case 'grade-file':
    case 'diagnose-file':
      return (
        <PerFileGradeDialog
          assessment={selected}
          file={(selected.files || []).find((f) => f.id === id)}
          state={state}
          setState={setState}
          update={update}
          open={open}
          notify={notify}
          diagnosisOnly={name === 'diagnose-file'}
          openAssessment={openAssessment}
          close={close}
        />
      );
    case 'delete-assessment':
      return (
        <DeleteAssessmentDialog
          assessment={selected}
          state={state}
          setState={setState}
          openAssessment={openAssessment}
          notify={notify}
          done={() => done('Assessment and all associated resources deleted')}
        />
      );
    case 'student-gaps':
      return <StudentGapsDialog assessment={selected} fileId={id} open={open} />;
    case 'setup':
      return (
        <SetupDialog
          assessment={selected}
          update={update}
          done={() => done('Questions, answer key and rubric saved')}
        />
      );
    case 'process':
      return (
        <ProcessDialog
          assessment={selected}
          update={update}
          open={open}
          done={() => {
            openAssessment(selected.id, 'Review');
            done(`${selected.subject} answer sheets graded. Review this assessment now.`);
          }}
        />
      );
    case 'approval':
      return (
        <ConfirmDialog
          eyebrow="Teacher authority"
          title="Final approval"
          text={`${selected.reviewed}/${selected.totalReviews} answers reviewed. Approving locks grading version ${selected.version} and makes results ready to publish.`}
          action="Approve final grades"
          onConfirm={() => {
            update(selected.id, { stage: 'xray' });
            done('Final grades approved. Learning X-Ray generated.');
          }}
        />
      );
    case 'publish':
      return (
        <ConfirmDialog
          eyebrow="High-impact action"
          title="Publish grades"
          text="Published grades become visible in reports. A new version is required for later changes."
          action="Publish grades"
          onConfirm={() => {
            update(selected.id, { stage: 'published', published: true });
            done('Grades published and reports updated.');
          }}
        />
      );
    case 'regrade':
      return (
        <RegradeDialog
          assessment={selected}
          update={update}
          done={() => done('Regrade version created and returned to teacher review')}
        />
      );
    case 'bulk-review':
      return (
        <BulkReview
          assessment={selected}
          update={update}
          done={() => done('High-confidence answers approved in bulk')}
        />
      );
    case 'quality':
      return (
        <QualityDialog
          assessment={selected}
          state={state}
          done={() => done('Assessment quality recommendations acknowledged')}
        />
      );
    case 'evidence':
      return <EvidenceDialog state={state} id={id} done={() => done('Evidence decision saved')} />;
    case 'group':
      return (
        <GroupDialog
          state={state}
          id={id}
          done={() => done('Temporary group membership saved')}
        />
      );

    /* ---- Interventions and resources ------------------------------------ */
    case 'intervention-form':
      return (
        <InterventionForm
          setState={setState}
          assessment={selected}
          done={() => done('Intervention created and added to the improvement cycle')}
        />
      );
    case 'followup':
      return (
        <FollowupDialog
          setState={setState}
          intervention={state.interventions.find((i) => i.id === id)}
          done={() => done('Follow-up evidence recorded.')}
        />
      );
    case 'study-guide':
      return (
        <StudyGuideDialog
          assessment={selected}
          fileId={id || undefined}
          open={open}
          setState={setState}
          done={() => done('Study guide saved to resources')}
        />
      );
    case 'worksheet-gap': {
      const result = selected.gradeResults?.[id];
      // The weakest gap is the worksheet's subject. The web sorted twice and,
      // for a result with no gaps, titled the worksheet "undefined Practice";
      // with no gap there is no preset title and the teacher types one.
      const weakest = result?.gaps.slice().sort((a, b) => a.mastery - b.mastery)[0];
      return (
        <WorksheetDialog
          setState={setState}
          sourceAssessment={selected}
          sourceResult={result}
          presetConcept={weakest?.concept}
          presetTitle={weakest ? `${weakest.concept} Practice` : undefined}
          presetStudent={result?.studentName}
          done={() => done('Practice worksheet and answer key ready in Resources')}
        />
      );
    }
    case 'worksheet':
    case 'worksheet-edit':
      // `selected` may be absent here: a worksheet can be written without a
      // source assessment, which is why this pair is not in NEEDS_ASSESSMENT.
      return (
        <WorksheetDialog
          setState={setState}
          sourceAssessment={selected}
          worksheet={state.resources.find((r) => r.id === id)}
          done={() => done('Worksheet saved to Resources with its answer key')}
        />
      );
    case 'worksheet-grade':
      return (
        <WorksheetGradingDialog
          worksheet={state.resources.find((r) => r.id === id)}
          setState={setState}
          done={() => done('Answer worksheets graded and results saved')}
        />
      );

    /* ---- Reports and sharing -------------------------------------------- */
    case 'report':
      return <ReportDialog done={() => done('Interactive report generated and saved')} />;
    case 'share-report':
      return (
        <ShareDialog done={() => done('Secure demo link created with expiry and access code')} />
      );
    case 'parent-share':
      return (
        <ParentShareDialog
          state={state}
          id={id}
          done={() => done('Student QR code is ready to share')}
        />
      );

    /* ---- People and school structure ------------------------------------ */
    case 'invite':
      return (
        <InviteDialog
          state={state}
          setState={setState}
          done={() => done('Invitation created and shown in Users')}
        />
      );
    case 'edit-user':
      return user ? (
        <UserEdit user={user} setState={setState} done={() => done('User details updated')} />
      ) : null;
    case 'credits-user':
      return user ? (
        <CreditAllocationDialog
          user={user}
          setState={setState}
          done={() => done('Credits assigned and audit trail recorded')}
        />
      ) : null;
    case 'reset-user':
      return user ? (
        <ConfirmDialog
          eyebrow="Account security"
          title="Reset password"
          text={`Send a password-reset link to ${user.email}?`}
          action="Send reset link"
          onConfirm={() => done('Password reset link sent')}
        />
      ) : null;
    case 'class':
      return <ClassDialog state={state} setState={setState} done={() => done('Class saved')} />;
    case 'school':
      return <SchoolDialog setState={setState} done={() => done('School profile saved')} />;
    case 'academic-year':
      return <AcademicYearDialog setState={setState} done={() => done('Academic year saved')} />;
    case 'student':
      return (
        <StudentDialog setState={setState} done={() => done('Student added to the roster')} />
      );
    case 'import-students':
      return (
        <RosterImport
          setState={setState}
          done={() => done('Student roster imported and validated')}
        />
      );
    case 'student-evidence':
      return (
        <StudentEvidence
          state={state}
          student={state.students.find((st) => st.id === id)}
          done={() => done('Student observation saved')}
        />
      );

    /* ---- The shell itself ----------------------------------------------- */
    case 'activity':
      return <Activity events={state.events} resetDemo={resetDemo} close={close} />;
    case 'notifications':
      return <NotificationDialog state={state} done={() => done('Notifications marked as read')} />;
    case 'consent-settings':
      return <ConsentDialog done={() => done('Privacy and consent choices saved')} />;
    case 'security-settings':
      return <SecurityDialog done={() => done('Security preference saved')} />;
    case 'review-help':
      return (
        <ConfirmDialog
          eyebrow="Workflow guide"
          title="Teacher review"
          text="Open the Review module to approve, edit, bulk-review, escalate or request a second AI opinion for every answer."
          action="Got it"
          onConfirm={close}
        />
      );
    case 'xray-details':
      return (
        <ConfirmDialog
          eyebrow="Learning X-Ray"
          title="Analysis ready"
          text="Open X-Ray to inspect student evidence, confidence, mastery and concept classifications."
          action="Got it"
          onConfirm={close}
        />
      );

    /* ---- Settings: the shared demonstration form ------------------------ */
    case 'privacy-settings':
      return (
        <SimpleSettings
          title="Privacy & retention"
          fields={[
            'Retention period',
            'Support access',
            'Login provider policy',
            'Notification frequency',
          ]}
          done={() => done('Privacy and retention settings saved')}
        />
      );
    case 'platform-config':
      return (
        <SimpleSettings
          title="Platform configuration"
          fields={['Configuration area', 'Enabled status', 'Scope', 'Approval note']}
          done={() => done('Platform configuration version saved')}
        />
      );
    case 'profile':
      return (
        <SimpleSettings
          title="Profile & preferences"
          fields={['Display name', 'Mobile number', 'Preferred language', 'Email notifications']}
          done={() => done('Profile saved')}
        />
      );
    case 'grading-settings':
      return (
        <SimpleSettings
          title="Grading preferences"
          fields={[
            'Strictness',
            'Partial-credit policy',
            'Spelling and grammar tolerance',
            'Working and units required',
            'Alternative methods',
            'Confidence threshold',
          ]}
          done={() => done('Grading preferences saved')}
        />
      );
    case 'appearance-settings':
      return (
        <SimpleSettings
          title="Appearance & accessibility"
          fields={['Appearance', 'High contrast', 'Text size', 'Reduced motion']}
          done={() => done('Accessibility preferences saved')}
        />
      );
    case 'notification-settings':
      return (
        <SimpleSettings
          title="Notification settings"
          fields={[
            'Reminder frequency',
            'Processing results',
            'Intervention reminders',
            'Follow-up reminders',
          ]}
          done={() => done('Notification settings saved')}
        />
      );
    case 'support-access':
      return (
        <SimpleSettings
          title="Temporary support access"
          fields={['Named support agent', 'Reason', 'Expiry', 'School approval']}
          done={() => done('Support-access decision saved and audited')}
        />
      );
    case 'report-settings':
      return (
        <SimpleSettings
          title="Report settings"
          fields={['Default expiry', 'Require OTP', 'Allow download', 'School branding']}
          done={() => done('Report defaults saved')}
        />
      );

    default:
      return unhandled(name);
  }
}

/** Compile-time exhaustiveness: a `DialogName` with no case above fails here.
 *  At runtime - a stale type restored from storage - it is an empty frame. */
function unhandled(name: never): null {
  void name;
  return null;
}
