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
  // must belong to one.
  const isSuperAdmin = /^priyadarshini\.adap@eduaihub(?:\.in)?$/i.test(authUser.email || "");

  const { data: existing, error: lookupError } = await db
    .from("users").select("school_id,role,status").eq("id", authUser.id).maybeSingle();
  if (lookupError) return Response.json({ error: lookupError.message }, { status: 500 });

  // This route used to create a school with status "Active" for anyone
  // completing their profile, which bypassed the approval workflow entirely -
  // the gate was real via /register-school and absent here. It no longer
  // creates schools at all.
  //
  // An invited teacher already has a row (the invitation upserts one), so they
  // never reach this branch. Someone signing up alone is sent to register their
  // school, which is the single reviewed front door.
  if (!existing && !isSuperAdmin) {
    return Response.json(
      {
        error: "Register your school to finish setting up your account.",
        code: "school_registration_required",
      },
      { status: 409 },
    );
  }

  const schoolId = isSuperAdmin ? null : existing?.school_id ?? null;
  const profile = {
    id: authUser.id,
    school_id: schoolId,
    email: authUser.email || "",
    name,
    // Role and status are never chosen here: an existing row keeps what it has,
    // and the seeded SuperAdmin is recognised by email.
    role: isSuperAdmin ? "SuperAdmin" : existing?.role || "Teacher",
    phone: String(body.phone || "").trim(),
    status: existing?.status || "Active",
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
