import { getAuthorizedProfile } from "../../../../lib/authorization";
import { getSupabaseServer } from "../../../../lib/supabase-server";

const academicYearPattern = /^\d{4}-\d{2}$/;

export async function GET(request: Request) {
  const profile = await getAuthorizedProfile(request);
  if (profile instanceof Response) return profile;
  const { data, error } = await getSupabaseServer()
    .from("hpc_learner_profiles")
    .select("id,academic_year,grade,attendance_percentage,interests_json,context_json,students(id,name,roll_number,status)")
    .eq("school_id", profile.school_id)
    .order("updated_at", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const {data:students,error:studentsError}=await getSupabaseServer().from("students").select("id,name,roll_number,status").eq("school_id",profile.school_id).eq("status","Active").order("name");
  if(studentsError)return Response.json({error:studentsError.message},{status:500});
  return Response.json({ learners: data || [], students: students || [] });
}

export async function POST(request: Request) {
  const profile = await getAuthorizedProfile(request);
  if (profile instanceof Response) return profile;
  const body = await request.json() as { studentId?: string; name?: string; rollNumber?: string; academicYear?: string; grade?: number; interests?: string[]; allAboutMe?: string };
  const existingStudentId=String(body.studentId||"").trim();
  const name = String(body.name || "").trim();
  const academicYear = String(body.academicYear || "").trim();
  const grade = Number(body.grade);
  if ((!existingStudentId && name.length < 2) || !academicYearPattern.test(academicYear) || body.grade === null || body.grade === undefined || String(body.grade).trim()==="" || !Number.isInteger(grade) || grade < 0 || grade > 12) {
    return Response.json({ error: "Learner name, grade and an academic year in YYYY-YY format are required." }, { status: 400 });
  }
  const db = getSupabaseServer();
  const studentId = existingStudentId || `hpc-student-${crypto.randomUUID()}`;
  if(existingStudentId){
    const {data:student,error}=await db.from("students").select("id").eq("id",existingStudentId).eq("school_id",profile.school_id).eq("status","Active").maybeSingle();
    if(error)return Response.json({error:error.message},{status:500});
    if(!student)return Response.json({error:"Choose an active student from your school."},{status:404});
    const {data:existing,error:lookupError}=await db.from("hpc_learner_profiles").select("id").eq("student_id",existingStudentId).eq("school_id",profile.school_id).eq("academic_year",academicYear).maybeSingle();
    if(lookupError)return Response.json({error:lookupError.message},{status:500});
    if(existing)return Response.json({error:"This student already has an HPC profile for this academic year."},{status:409});
  }else{
  const { error: studentError } = await db.from("students").insert({
    id: studentId, school_id: profile.school_id, name, roll_number: String(body.rollNumber || "").trim() || null, status: "Active",
  });
  if (studentError) return Response.json({ error: studentError.message }, { status: 500 });
  }
  const { data: learner, error: learnerError } = await db.from("hpc_learner_profiles").insert({
    school_id: profile.school_id,
    student_id: studentId,
    academic_year: academicYear,
    grade,
    interests_json: Array.isArray(body.interests) ? body.interests.filter(value => typeof value === "string" && value.trim()).map(value => value.trim()) : [],
    context_json: { all_about_me: String(body.allAboutMe || "").trim() },
    updated_by: profile.id,
  }).select("id,academic_year,grade,attendance_percentage,interests_json,context_json,students(id,name,roll_number,status)").single();
  if (learnerError) return Response.json({ error: learnerError.code==="23505"?"This student already has an HPC profile for this academic year.":learnerError.message }, { status: learnerError.code==="23505"?409:500 });
  return Response.json({ learner }, { status: 201 });
}
