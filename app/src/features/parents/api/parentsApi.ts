/**
 * The parent portal's network surface.
 *
 * Two services answer here, and which one is not arbitrary:
 *
 *   * **Django** owns every write and the link itself - creating the account,
 *     redeeming an invite code, listing which children a link reaches. That is
 *     where the capability matrix, the redemption throttle and the audit trail
 *     live, and none of them can be enforced from a route this app serves.
 *   * **`/api/parent/children`** (app/src/app/api) still serves the dashboard's
 *     *reports*, because the read model behind it - `parent_child_reports()` -
 *     has not been ported to Django yet (plan row 13.3). It selects field by
 *     field, so OCR transcripts, AI rationale and other people's children are
 *     structurally absent from it.
 *
 * Both are scoped by the same `parent_student_links` rows, so they cannot
 * disagree about which children a parent has - only about how much they say
 * about each. When 13.3 lands, the second one goes and this module is the one
 * place that has to change.
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

/** The children the caller's links reach. Empty until a code is redeemed. */
export function linkedChildren() {
  return api.get<{ results: LinkedChild[] }>('/api/v1/parents/children/');
}

export { ApiError };
