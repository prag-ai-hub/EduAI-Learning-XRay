/**
 * Where each role lands after signing in.
 *
 * Kept in one place because the redirect happens in three: after an
 * email/password sign-in, after returning from an OAuth provider, and when an
 * already-signed-in visitor opens /signin again.
 */
export type AppRole = "SuperAdmin" | "SchoolAdmin" | "Teacher" | "Parent";

export const LANDING: Record<AppRole, string> = {
  SuperAdmin:  "/app",
  SchoolAdmin: "/app",
  Teacher:     "/app",
  // Parents never see the teaching workspace. Their portal reads the published
  // read model, not a teacher's workspace snapshot.
  Parent:      "/parent",
};

export function toAppRole(value:unknown):AppRole{
  const role = String(value || "");
  if (role === "Admin") return "SchoolAdmin";          // pre-M7 value
  return (["SuperAdmin","SchoolAdmin","Teacher","Parent"] as string[]).includes(role)
    ? role as AppRole : "Teacher";
}

/**
 * A signed-in visitor with no profile row yet goes to /app, which owns the
 * profile-completion form — including a Parent, because until the profile
 * exists their role is unknown.
 */
export function landingPath(profile:{role?:unknown}|null|undefined){
  if (!profile) return "/app";
  return LANDING[toAppRole(profile.role)];
}
