import { getAuthorizedProfile } from "../../../../lib/authorization";
import { getSupabaseServer } from "../../../../lib/supabase-server";

const academicYearPattern = /^\d{4}-\d{2}$/;

export async function GET(request: Request) {
  const profile = await getAuthorizedProfile(request);
  if (profile instanceof Response) return profile;
  const { data, error } = await getSupabaseServer()
    .from("hpc_learner_profiles")
    .select("id,academic_year,attendance_percentage,interests_json,context_json,students(id,name,roll_number,status)")
    .eq("school_id", profile.school_id)
    .order("updated_at", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ learners: data || [] });
}

export async function POST(request: Request) {
  const profile = await getAuthorizedProfile(request);
  if (profile instanceof Response) return profile;
  const body = await request.json() as { name?: string; rollNumber?: string; academicYear?: string; interests?: string[]; allAboutMe?: string };
  const name = String(body.name || "").trim();
  const academicYear = String(body.academicYear || "").trim();
  if (name.length < 2 || !academicYearPattern.test(academicYear)) {
    return Response.json({ error: "Learner name and an academic year in YYYY-YY format are required." }, { status: 400 });
  }
  const db = getSupabaseServer();
  const studentId = `hpc-student-${crypto.randomUUID()}`;
  const { error: studentError } = await db.from("students").insert({
    id: studentId, school_id: profile.school_id, name, roll_number: String(body.rollNumber || "").trim() || null, status: "Active",
  });
  if (studentError) return Response.json({ error: studentError.message }, { status: 500 });
  const { data: learner, error: learnerError } = await db.from("hpc_learner_profiles").insert({
    school_id: profile.school_id,
    student_id: studentId,
    academic_year: academicYear,
    interests_json: Array.isArray(body.interests) ? body.interests.filter(value => typeof value === "string" && value.trim()).map(value => value.trim()) : [],
    context_json: { all_about_me: String(body.allAboutMe || "").trim() },
    updated_by: profile.id,
  }).select("id,academic_year,attendance_percentage,interests_json,context_json,students(id,name,roll_number,status)").single();
  if (learnerError) return Response.json({ error: learnerError.message }, { status: 500 });
  return Response.json({ learner }, { status: 201 });
}
