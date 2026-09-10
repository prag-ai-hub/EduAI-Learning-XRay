/**
 * The background fan-out that turns one graded answer sheet into the four
 * documents a parent meeting needs.
 *
 * Ported verbatim from frontend/app/ui/FunctionalEduAIApp.tsx:1151-1189.
 *
 * Two things about the order matter and are unchanged:
 *
 *  1. The study guide and the worksheet are written into the workspace blob
 *     *before* anything is published. The teacher's own copy is saved first, so
 *     a failure further down never looks like losing their work.
 *  2. The trim to the read-model shape happens only once /api/publish has
 *     confirmed. Trimming first and publishing second would drop the full gap
 *     detail with no durable home to fall back to.
 *
 * A publish failure is logged, not raised, for the same reason: the read model
 * is what makes a result readable by a parent or an administrator at all - the
 * workspace blob is keyed to one teacher - but it is a second copy, and its
 * absence is not the teacher's problem to solve mid-review.
 */

import { authFetch } from '@/features/auth/api/authApi';
import { inferDocumentRole } from '@/features/workspace/lib/documents';
import { trimPublishedResource, trimPublishedResult } from '@/features/workspace/lib/read-model';
import type {
  Assessment,
  DemoState,
  GradeResult,
  Worksheet,
  WorksheetContent,
} from '@/shared/types/workspace';
import type { SetWorkspace } from '@/shared/types/workspace-props';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export async function generateAllStudentResources(
  assessment: Assessment,
  result: GradeResult,
  setState: SetWorkspace,
): Promise<{ guide: Worksheet; worksheet: Worksheet }> {
  const guideResponse = await authFetch('/api/generate-study-guide', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      subject: assessment.subject,
      concept: result.gaps[0]?.concept || assessment.subject,
      studentName: result.studentName,
      mastery: result.gaps[0]?.mastery ?? 0,
      gaps: result.gaps,
      feedback: result.feedback,
      ocrText: result.ocrText,
      evidenceFiles: assessment.files.map(
        (file) => `${file.documentRole || inferDocumentRole(file.name)}: ${file.name}`,
      ),
    }),
  });
  const guidePayload = await guideResponse.json();
  if (!guideResponse.ok) throw new Error(guidePayload?.error || 'Study-guide generation failed');

  const concepts = result.gaps.map((g) => g.concept);

  const worksheetResponse = await authFetch('/api/generate-worksheet', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      subject: assessment.subject,
      grade: assessment.grade,
      concepts: concepts.length ? concepts : [assessment.subject],
      difficulty: 'Mixed',
      template: 'Guided recovery',
      mcqCount: Math.max(6, concepts.length * 2),
      subjectiveCount: Math.max(4, concepts.length),
      studentName: result.studentName,
      diagnosticGaps: result.gaps,
    }),
  });
  const worksheetPayload = await worksheetResponse.json();
  if (!worksheetResponse.ok) throw new Error(worksheetPayload?.error || 'Worksheet generation failed');
  // The latency record belongs in state.apiLog, not inside the worksheet body.
  delete worksheetPayload.timing;

  const guide: Worksheet = {
    id: `guide-${assessment.id}-${result.fileId}`,
    title: guidePayload.guide.title,
    type: 'Study Guide',
    status: 'Saved',
    subject: assessment.subject,
    grade: assessment.grade,
    assessmentId: assessment.id,
    concepts,
    guide: guidePayload.guide,
    studentName: result.studentName,
    evidenceFiles: assessment.files.map(
      (file) => `${file.documentRole || inferDocumentRole(file.name)} · ${file.name}`,
    ),
  };

  const worksheet: Worksheet = {
    id: `worksheet-${assessment.id}-${result.fileId}`,
    title: `${result.studentName} Personalized Practice`,
    type: 'Targeted worksheet',
    status: 'Approved',
    template: 'Guided recovery',
    concept: concepts[0] || assessment.subject,
    concepts,
    subject: assessment.subject,
    grade: assessment.grade,
    assessmentId: assessment.id,
    studentName: result.studentName,
    mcq: Math.max(6, concepts.length * 2),
    subjective: Math.max(4, concepts.length),
    difficulty: 'Mixed',
    answerSheets: 0,
    gradedSheets: 0,
    content: worksheetPayload as WorksheetContent,
  };

  setState((state: DemoState) => ({
    ...state,
    resources: [
      guide,
      worksheet,
      ...state.resources.filter((item) => item.id !== guide.id && item.id !== worksheet.id),
    ],
    events: [`All reports ready · ${result.studentName}`, ...state.events],
  }));

  try {
    const published = await authFetch('/api/publish', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ assessment, result, resources: [guide, worksheet] }),
    });
    if (published.ok) {
      const trimmedResult = trimPublishedResult(result);
      setState((state: DemoState) => ({
        ...state,
        assessments: state.assessments.map((item) =>
          item.id === assessment.id
            ? { ...item, gradeResults: { ...(item.gradeResults || {}), [result.fileId]: trimmedResult } }
            : item,
        ),
        resources: state.resources.map((item) =>
          item.id === guide.id
            ? trimPublishedResource(guide)
            : item.id === worksheet.id
              ? trimPublishedResource(worksheet)
              : item,
        ),
      }));
    } else {
      console.error('Publish to read model failed', await published.text());
    }
  } catch (cause) {
    console.error('Publish to read model failed', cause);
  }

  return { guide, worksheet };
}
