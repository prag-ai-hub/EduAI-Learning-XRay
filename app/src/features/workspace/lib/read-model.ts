/**
 * The published read model: what the workspace snapshot keeps, and how the rest
 * is fetched back when a screen actually needs it.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx:1108-1150.
 *
 * The whole `DemoState` is one JSON document that is PUT to /api/workspace on
 * every change, so anything left in it is paid for on every keystroke. A graded
 * result's diagnostic prose and its per-question decisions are the bulk of it
 * and are read by exactly two screens, so publishing trims them out and the two
 * screens hydrate on open. The trim is lossless in the sense that matters:
 * /api/publish still holds the full record.
 */

import { authFetch } from '@/features/auth/api/authApi';
import type { GradeResult, Worksheet } from '@/shared/types/workspace';

/**
 * A published result, reduced to what renders synchronously.
 *
 * Gaps keep only what the heatmap, concept-mastery aggregates and student lists
 * read. The diagnostic prose - finding, misconception, evidence, rework,
 * remediation sequence - is only needed by the learning-gap dialog and its PDF,
 * both of which hydrate. `questionCount` is preserved from the decisions being
 * dropped so the summary line still has a number to show.
 */
export function trimPublishedResult(result: GradeResult): GradeResult {
  const { ocrText, questionDecisions, ...rest } = result;
  void ocrText;
  void questionDecisions;
  return {
    ...rest,
    gaps: (result.gaps || []).map((gap) => ({
      concept: gap.concept,
      mastery: gap.mastery,
      severity: gap.severity,
    })),
    published: true,
    questionCount: questionDecisions?.length ?? result.questionCount,
  };
}

/** The same for a resource: the worksheet body and the study guide come back on demand. */
export function trimPublishedResource(resource: Worksheet): Worksheet {
  const { guide, content, ...rest } = resource;
  void guide;
  void content;
  return { ...rest, published: true };
}

/**
 * The full result, fetched only when it is missing.
 *
 * Three early exits, in order: an unpublished result was never trimmed; a
 * result that still has its decisions and diagnostic findings is already whole;
 * and any failure returns the trimmed copy rather than throwing, because a
 * report that opens without its prose is better than one that does not open.
 */
export async function hydrateResult(
  assessmentId: string,
  result: GradeResult,
): Promise<GradeResult> {
  if (!result.published) return result;
  if (result.questionDecisions?.length && result.gaps?.some((gap) => gap.finding)) return result;
  try {
    const response = await authFetch(
      `/api/publish?assessmentId=${encodeURIComponent(assessmentId)}&fileId=${encodeURIComponent(
        result.fileId,
      )}`,
      { cache: 'no-store' },
    );
    if (!response.ok) return result;
    const payload = await response.json();
    return {
      ...result,
      ocrText: payload.ocrText || '',
      questionDecisions: payload.questionDecisions || [],
      gaps: Array.isArray(payload.gaps) && payload.gaps.length ? payload.gaps : result.gaps,
    };
  } catch {
    return result;
  }
}

/** The same for a resource. Also a no-op for anything already carrying a body. */
export async function hydrateResource(resource: Worksheet): Promise<Worksheet> {
  if (resource?.guide || resource?.content) return resource;
  if (!resource?.published) return resource;
  try {
    const response = await authFetch(
      `/api/publish?resourceId=${encodeURIComponent(resource.id)}`,
      { cache: 'no-store' },
    );
    if (!response.ok) return resource;
    const payload = await response.json();
    return {
      ...resource,
      guide: payload.guide ?? resource.guide,
      content: payload.content ?? resource.content,
    };
  } catch {
    return resource;
  }
}
