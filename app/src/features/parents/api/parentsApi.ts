/**
 * The parent portal's network surface. Django, for all of it.
 *
 * That was briefly not true: the dashboard read `/api/parent/children`, an Expo
 * server route that called `parent_child_reports()` with the Supabase
 * service-role key. It answered correctly, and it answered outside everything
 * that makes the answer trustworthy - no capability matrix, no throttle, no
 * audit row, and a second copy of the scoping rule to keep in step with the
 * first. Plan row 13.3 replaced it with `GET /parents/reports`, and that route
 * is gone rather than left as a fallback: two paths to the same data is one
 * path more than can be reasoned about.
 *
 * What the server returns is a whitelist, not a filter. `parent_child_reports`
 * (M11) selects score, feedback, gaps and generated resources field by field,
 * so `ocr_text`, `question_decisions_json` and every trace of AI rationale are
 * structurally absent - not omitted here, absent there. Nothing in this module
 * needs to redact anything, and nothing in it should try.
 */

import { ApiError, api } from '@/shared/api/django';

/** One linked child, as Django's `ChildSerializer` returns them. */
export type LinkedChild = {
  id: string;
  name: string;
  roll_number: string | null;
  status: string;
  class_name: string | null;
  school_name: string;
  relationship: string;
  linked_at: string;
};

export type ParentProfile = {
  id: string;
  name: string;
  email: string;
  role: string;
  phone: string | null;
  status: string;
};

/**
 * Create the caller's own Parent profile.
 *
 * Supabase signup has to have happened first - `public.users.id` carries a
 * foreign key to `auth.users.id`, so Django cannot create an identity. The
 * email is taken from the verified token and there is deliberately no field for
 * it here: an email-bound invite code is matched against it.
 *
 * Idempotent, which is what lets the join screen call it before every
 * redemption without checking first.
 */
export function signUpAsParent(input: { name: string; phone?: string }) {
  return api.post<{ profile: ParentProfile; created: boolean }>('/api/v1/accounts/parents', {
    name: input.name,
    ...(input.phone ? { phone: input.phone } : {}),
  });
}

/**
 * Redeem an invite code into a link.
 *
 * Every refusal is the same 400 with the same wording - wrong, expired, spent,
 * revoked and issued-to-another-address are indistinguishable on purpose, so a
 * code cannot be used to find out which codes or which accounts exist. Do not
 * try to improve the message by guessing which one it was.
 */
export function redeemInviteCode(code: string) {
  return api.post<{
    link: { id: string; student_id: string; relationship: string };
    child: LinkedChild | null;
  }>('/api/v1/parents/links/redeem', { code });
}

/**
 * End the caller's own access to one child.
 *
 * The link is marked revoked, not deleted, so the access that existed stays on
 * the record. Getting it back takes a NEW code from the school: a revoked link
 * is restored only by a fully valid, unspent code (migration M18), because
 * revoking is also how a school withdraws access for safeguarding reasons, and
 * an old code must not be a way around that.
 */
export function unlinkChild(studentId: string) {
  return api.post<void>(`/api/v1/parents/children/${encodeURIComponent(studentId)}/unlink/`);
}

/** The children the caller's links reach. Empty until a code is redeemed. */
export function linkedChildren() {
  return api.get<{ results: LinkedChild[] }>('/api/v1/parents/children/');
}

/* ------------------------------------------------------------------------- *
 * The reports read model (M11), as `GET /parents/reports` shapes it
 * ------------------------------------------------------------------------- */

/** One published assessment result. */
export type ChildResult = {
  assessmentId: string;
  title: string;
  subject: string;
  date: string;
  score: number;
  maxMarks: number;
  feedback: string | null;
  gaps: { concept: string; mastery?: number }[];
};

/** One generated resource the teacher published alongside a result. */
export type ChildResource = {
  id: string;
  title: string;
  type: string;
  content?: unknown;
};

/**
 * One planned intervention.
 *
 * `classInterventions`, never `interventions`, and the server names it that
 * way for a reason worth repeating at the point a screen reads it:
 * `public.interventions` carries an `assessment_id` and no `student_id`, so
 * this is the plan for a CLASS's assessment. Two siblings in one class get
 * byte-identical lists. Rendered under a heading that reads as personal, a
 * parent would reasonably take "practise comparing fractions" as advice
 * written about their own child. The UI has to say whose plan it is.
 */
export type ClassIntervention = {
  id: string;
  concept: string;
  format: string | null;
  duration: string | null;
  status: string;
  followupDate: string | null;
  title: string;
  subject: string;
};

/** One linked child and everything the school has approved about them. */
export type ChildReport = {
  studentId: string;
  studentName: string;
  rollNumber: string | null;
  className: string;
  schoolName: string;
  results: ChildResult[];
  resources: ChildResource[];
  classInterventions: ClassIntervention[];
};

/**
 * Every linked child's approved results, resources and class interventions.
 *
 * Scoping is inside the SQL function, which joins through the active links
 * itself - so an unlinked parent gets an empty list rather than an error, and
 * a revoked link stops answering without this having to know it happened.
 */
export function childReports() {
  return api.get<{ children: ChildReport[] }>('/api/v1/parents/reports');
}

export { ApiError };
