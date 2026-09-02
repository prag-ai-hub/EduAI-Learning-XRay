import { getAuthorizedProfile, requireRole } from "../../../lib/authorization";
import { getSupabaseServer } from "../../../lib/supabase-server";

/**
 * Publishes one student's finished result out of the teacher's workspace blob
 * into the normalized read model.
 *
 * Until this exists, a graded result is readable only by the teacher who owns
 * the blob — parents and administrators have no query path to it, and the blob
 * grows until it hits the 4 MB cap.
 */
export async function POST(request: Request) {
  const profile = await getAuthorizedProfile(request);
  const denied = requireRole(profile, "Teacher", "SchoolAdmin");
  if (denied) return denied;
  if (profile instanceof Response) return profile;
  if (!profile.school_id) {
    return Response.json({ error: "Your profile is not assigned to a school." }, { status: 403 });
  }

  const body = await request.json() as { assessment?: unknown; result?: unknown; resources?: unknown };
  if (!body.assessment || !body.result) {
    return Response.json({ error: "An assessment and a result are required." }, { status: 400 });
  }

  const { data, error } = await getSupabaseServer().rpc("publish_student_result", {
    p_school_id: profile.school_id,
    p_teacher_id: profile.id,
    p_assessment: body.assessment,
    p_result: body.result,
    p_resources: Array.isArray(body.resources) ? body.resources : [],
  });

  if (error) {
    // Publication is additive: the teacher's own copy is already saved in the
    // workspace, so a failure here must not present as losing their work.
    console.error("publish_student_result failed", error);
    return Response.json({ error: error.message, published: false }, { status: 500 });
  }
  const row = Array.isArray(data) ? data[0] : data;
  return Response.json({
    published: true,
    assessmentId: row?.out_assessment_id ?? null,
    studentId: row?.out_student_id ?? null,
    gradeResultId: row?.out_grade_result_id ?? null,
    resourcesPublished: row?.out_resources_published ?? 0,
  });
}


/**
 * Rehydrates what publication removed from the workspace blob.
 *
 * Once a result is published, its OCR transcript, question decisions and
 * generated resource bodies are dropped from the blob — together roughly 23 KB
 * of the 31.7 KB each student-assessment used to occupy. They are read back
 * from the read model only when a screen actually needs them.
 *
 *   /api/publish?assessmentId=..&fileId=..   -> ocrText + questionDecisions
 *   /api/publish?resourceId=..               -> guide / content body
 */
export async function GET(request: Request) {
  const profile = await getAuthorizedProfile(request);
  const denied = requireRole(profile, "Teacher", "SchoolAdmin", "SuperAdmin");
  if (denied) return denied;
  if (profile instanceof Response) return profile;

  const url = new URL(request.url);
  const db = getSupabaseServer();
  const resourceId = url.searchParams.get("resourceId");

  if (resourceId) {
    const { data, error } = await db.from("resources")
      .select("id,content_json,school_id").eq("id", resourceId).maybeSingle();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    if (!data) return Response.json({ error: "Resource not found." }, { status: 404 });
    if (profile.role !== "SuperAdmin" && data.school_id !== profile.school_id) {
      return Response.json({ error: "This resource belongs to another school." }, { status: 403 });
    }
    const body = (data.content_json || {}) as Record<string, unknown>;
    return Response.json({ id: data.id, guide: body.guide ?? null, content: body.content ?? null });
  }

  const assessmentId = url.searchParams.get("assessmentId");
  const fileId = url.searchParams.get("fileId");
  if (!assessmentId || !fileId) {
    return Response.json({ error: "assessmentId and fileId are required." }, { status: 400 });
  }
  const { data, error } = await db.from("grade_results")
    .select("ocr_text,question_decisions_json,gaps_json,score,max_marks,school_id")
    .eq("assessment_id", assessmentId).eq("file_id", fileId)
    .order("grading_version", { ascending: false }).limit(1).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: "This result has not been published." }, { status: 404 });
  if (profile.role !== "SuperAdmin" && data.school_id !== profile.school_id) {
    return Response.json({ error: "This result belongs to another school." }, { status: 403 });
  }
  return Response.json({
    ocrText: data.ocr_text ?? "",
    questionDecisions: data.question_decisions_json ?? [],
    gaps: data.gaps_json ?? [],
    score: data.score, maxMarks: data.max_marks,
  });
}
