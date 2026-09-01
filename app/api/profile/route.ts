import { getAuthenticatedUser, unauthorized } from "../../../lib/supabase-auth";
import { getSupabaseServer } from "../../../lib/supabase-server";

export async function GET(request: Request) {
  const authUser = await getAuthenticatedUser(request);
  if (!authUser) return unauthorized();
  const db = getSupabaseServer();
  const { data: user, error } = await db.from("users").select("*").eq("id", authUser.id).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!user) return Response.json({ profile: null });
  const { data: school } = await db.from("schools").select("name").eq("id", user.school_id).maybeSingle();
  return Response.json({ profile: { ...user, school: school?.name || "", remaining_credits: Math.max(0,(user.total_credits||0)-(user.used_credits||0)) } });
}

export async function PUT(request: Request) {
  const authUser = await getAuthenticatedUser(request);
  if (!authUser) return unauthorized();
  const body = await request.json() as {
    name?: string; school?: string; phone?: string; subjects?: string; classes?: string;
  };
  const name = String(body.name || "").trim();
  const schoolName = String(body.school || "").trim();
  if (name.length < 2 || schoolName.length < 2) {
    return Response.json({ error: "Name and school are required." }, { status: 400 });
  }
  const db = getSupabaseServer();
  // M7 invariant: a SuperAdmin belongs to no school, and SchoolAdmin/Teacher
  // must belong to one. Creating a school for a SuperAdmin would be rejected by
  // users_role_school_scope_check.
  const isSuperAdmin = /^priyadarshini\.adap@eduaihub(?:\.in)?$/i.test(authUser.email || "");
  const schoolId = isSuperAdmin ? null : `school-${authUser.id}`;
  if (schoolId) {
    const { error: schoolError } = await db.from("schools").upsert({
      id: schoolId,
      name: schoolName,
      status: "Active",
      updated_at: new Date().toISOString(),
    });
    if (schoolError) return Response.json({ error: schoolError.message }, { status: 500 });
  }
  const profile = {
    id: authUser.id,
    school_id: schoolId,
    email: authUser.email || "",
    name,
    role: isSuperAdmin ? "SuperAdmin" : "Teacher",
    phone: String(body.phone || "").trim(),
    status: "Active",
    profile_json: {
      subjects: String(body.subjects || "").trim(),
      classes: String(body.classes || "").trim(),
      onboarding_complete: true,
    },
    updated_at: new Date().toISOString(),
  };
  const { error } = await db.from("users").upsert(profile);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ profile: { ...profile, school: schoolName } });
}
