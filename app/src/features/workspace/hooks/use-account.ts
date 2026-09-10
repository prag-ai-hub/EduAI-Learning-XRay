/**
 * The two account-level fetches the workspace shell used to run inline.
 *
 * Ported from the last two effects of `WorkspaceApp` in
 * frontend/app/ui/FunctionalEduAIApp.tsx (:336-337). They are here rather than
 * in the shell because neither is about the workspace document: credits and the
 * staff list are server-owned rows that happen to be displayed alongside it.
 *
 * Both swallow their errors, exactly as the originals did. A credit badge that
 * cannot load shows zero; a user list that cannot load leaves whatever the
 * workspace snapshot already held. Neither is worth a toast in front of a
 * teacher who is trying to grade.
 */

import { useEffect, useState } from 'react';

import { authFetch } from '@/features/auth/api/authApi';
import type {
  ApiUserRow,
  CreditSummary,
  Role,
  SetWorkspace,
  User,
} from '@/shared/types/workspace';

const NO_CREDITS: CreditSummary = { total: 0, used: 0, remaining: 0 };

/**
 * The signed-in account's credit balance, refetched when the role changes.
 *
 * `role` is the dependency the web app used. It is not that credits depend on
 * the role - they do not - but that a role change is the one moment the shell
 * knows the identity behind the request may have changed.
 */
export function useCredits(role: Role): CreditSummary {
  const [credits, setCredits] = useState<CreditSummary>(NO_CREDITS);

  useEffect(() => {
    let active = true;
    void authFetch('/api/credits', { cache: 'no-store' })
      .then((r) => r.json())
      .then((p) => {
        // The guard is new: the web app set state unconditionally, which is
        // harmless in a browser tab and a warning on a screen the teacher has
        // already navigated away from.
        if (active && p.credits) setCredits(p.credits);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [role]);

  return credits;
}

/**
 * The role the staff-list fetch is gated on.
 *
 * The web app wrote `if (role !== "Admin") return;`, but "Admin" stopped being
 * a role at M7: `toRole()` in `demo-state.ts` maps it to "SchoolAdmin" before a
 * profile ever reaches here, and `Role` has no "Admin" member at all. So the
 * effect had not run since M7 and the admin Users screen showed whatever
 * `DemoState.users` held - which for a real school is three seeded, fictional
 * teachers.
 *
 * Ported as found, then corrected here rather than carried forward. Leaving it
 * is not the conservative choice: it means the Users screen ships showing
 * invented staff to a real administrator, who has no way to tell that the list
 * is not their school. Fetching the real list is what the code was always
 * trying to do.
 */
const ADMIN_ROLE_GATE: Role = 'SchoolAdmin';

/**
 * Replaces `state.users` with GET /api/admin/users, mapped onto the local
 * `User` shape.
 *
 * `school` comes from the caller's profile because the API does not return one:
 * every row belongs to the requesting admin's school by construction.
 */
export function useAdminUsers(role: Role, school: string, setState: SetWorkspace): void {
  useEffect(() => {
    if (role !== ADMIN_ROLE_GATE) return;

    let active = true;
    void authFetch('/api/admin/users', { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        if (!active) return;
        setState((s) => ({
          ...s,
          users: (payload.users || []).map(
            (u: ApiUserRow): User => ({
              id: u.id,
              name: u.name || u.email,
              email: u.email,
              role: u.role ?? '',
              school,
              phone: '',
              status:
                u.status === 'Inactive' ? 'Inactive' : u.status === 'Invited' ? 'Invited' : 'Active',
              totalCredits: u.total_credits,
              usedCredits: u.used_credits,
            }),
          ),
        }));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [role, school, setState]);
}
