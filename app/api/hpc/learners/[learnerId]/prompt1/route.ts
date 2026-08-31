import { getAuthorizedProfile } from "../../../../../../lib/authorization";
import { getSupabaseServer } from "../../../../../../lib/supabase-server";

type PromptOneBody = {
  action?: "context" | "goal" | "mapping";
  attendancePercentage?: number | string | null;
  lowAttendanceReason?: string;
  learnerContext?: string;
  homeResources?: string;
  grade?: number | string | null;
  goalType?: string;
  content?: string;
  domainId?: string;
  curricularGoalId?: string;
  competencyId?: string;
  learningOutcomeId?: string;
  abilityId?: string;
  mappingNote?: string;
};

async function learnerForSchool(learnerId: string, schoolId: string) {
  return getSupabaseServer().from("hpc_learner_profiles")
    .select("id,school_id,student_id,academic_year,grade,attendance_percentage,low_attendance_reason,interests_json,context_json,home_learning_resources_json,students(id,name,roll_number,status)")
    .eq("id", learnerId).eq("school_id", schoolId).maybeSingle();
}

export async function GET(request: Request, { params }: { params: Promise<{ learnerId: string }> }) {
  const profile = await getAuthorizedProfile(request);
  if (profile instanceof Response) return profile;
  if (!profile.school_id) return Response.json({ error: "A school profile is required." }, { status: 403 });
  const { learnerId } = await params;
  const db = getSupabaseServer();
  const { data: learner, error } = await learnerForSchool(learnerId, profile.school_id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!learner) return Response.json({ error: "HPC learner profile not found." }, { status: 404 });
  const stageResult = learner.grade !== null ? await db.from("hpc_stage_templates").select("framework_version_id,stage_code,title,grade_from,grade_to,hpc_template_sections(section_code,title,required,configuration_json),hpc_framework_versions!inner(status)").eq("hpc_framework_versions.status","approved").eq("is_active",true).lte("grade_from",learner.grade).gte("grade_to",learner.grade).order("created_at",{ascending:false}).limit(1).maybeSingle() : {data:null,error:null};
  if(stageResult.error)return Response.json({error:stageResult.error.message},{status:500});
  const framework=stageResult.data?{id:stageResult.data.framework_version_id}:null;
  const [{ data: goals, error: goalsError }, { data: mappings, error: mappingsError }] = await Promise.all([
    db.from("hpc_goals_aspirations").select("id,goal_type,content,source_type,approval_status,created_at").eq("learner_profile_id", learner.id).order("created_at", { ascending: false }),
    db.from("hpc_competency_mappings").select("id,mapping_note,mapping_status,created_at,hpc_domains(label,code),hpc_curricular_goals(code,label),hpc_competencies(code,label),hpc_learning_outcomes(code,label),hpc_abilities(label)").eq("learner_profile_id", learner.id).order("created_at", { ascending: false }),
  ]);
  if (goalsError || mappingsError) return Response.json({ error: goalsError?.message || mappingsError?.message || "Unable to load Prompt 1 records." }, { status: 500 });
  const { data: catalogue, error: catalogueError } = framework ? await db.from("hpc_domains").select("id,code,label,hpc_curricular_goals(id,code,label,hpc_competencies(id,code,label,hpc_learning_outcomes(id,code,label)))").eq("framework_version_id", framework.id).order("label") : { data: [], error: null };
  if (catalogueError) return Response.json({ error: catalogueError.message }, { status: 500 });
  return Response.json({ learner, goals: goals || [], mappings: mappings || [], stage: stageResult.data || null, catalogue: catalogue || [] });
}

export async function POST(request: Request, { params }: { params: Promise<{ learnerId: string }> }) {
  const profile = await getAuthorizedProfile(request);
  if (profile instanceof Response) return profile;
  if (!profile.school_id) return Response.json({ error: "A school profile is required." }, { status: 403 });
  const { learnerId } = await params;
  const db = getSupabaseServer();
  const { data: learner, error } = await learnerForSchool(learnerId, profile.school_id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!learner) return Response.json({ error: "HPC learner profile not found." }, { status: 404 });
  const body = await request.json() as PromptOneBody;

  if (body.action === "context") {
    const attendance = body.attendancePercentage === null || body.attendancePercentage === undefined || body.attendancePercentage === "" ? null : Number(body.attendancePercentage);
    if (attendance !== null && (!Number.isFinite(attendance) || attendance < 0 || attendance > 100)) return Response.json({ error: "Attendance must be between 0 and 100." }, { status: 400 });
    const grade = body.grade === null || body.grade === undefined || body.grade === "" ? learner.grade : Number(body.grade);
    if (grade !== null && (!Number.isInteger(grade) || grade < 0 || grade > 12)) return Response.json({ error: "Grade must be between 0 and 12." }, { status: 400 });
    const { data, error: updateError } = await db.from("hpc_learner_profiles").update({
      grade,
      attendance_percentage: attendance,
      low_attendance_reason: String(body.lowAttendanceReason || "").trim() || null,
      context_json: { ...(learner.context_json || {}), learner_context: String(body.learnerContext || "").trim() },
      home_learning_resources_json: { resources: String(body.homeResources || "").trim() },
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    }).eq("id", learner.id).eq("school_id", profile.school_id).select("id,attendance_percentage,low_attendance_reason,context_json,home_learning_resources_json").single();
    if (updateError) return Response.json({ error: updateError.message }, { status: 500 });
    return Response.json({ learner: data });
  }

  if (body.action === "goal") {
    const allowed = new Set(["all_about_me", "academic_goal", "personal_goal", "ambition", "career_aspiration", "future_plan", "strength", "support", "time_management"]);
    const goalType = String(body.goalType || "");
    const content = String(body.content || "").trim();
    if (!allowed.has(goalType) || content.length < 2) return Response.json({ error: "Choose a goal type and enter at least two characters." }, { status: 400 });
    const { data, error: goalError } = await db.from("hpc_goals_aspirations").insert({ learner_profile_id: learner.id, goal_type: goalType, content, source_type: "teacher", approval_status: "approved", approved_by: profile.id, approved_at: new Date().toISOString() }).select("id,goal_type,content,source_type,approval_status,created_at").single();
    if (goalError) return Response.json({ error: goalError.message }, { status: 500 });
    return Response.json({ goal: data }, { status: 201 });
  }

  if (body.action === "mapping") {
    const domainId = String(body.domainId || "");
    const curricularGoalId = String(body.curricularGoalId || "");
    const competencyId = String(body.competencyId || "");
    const abilityId = String(body.abilityId || "");
    const { data: domain, error: domainError } = await db.from("hpc_domains").select("id,framework_version_id,label").eq("id", domainId).maybeSingle();
    if (domainError || !domain) return Response.json({ error: "Choose an approved framework domain." }, { status: 400 });
    const { data: competency, error: competencyError } = await db.from("hpc_competencies").select("id,curricular_goal_id,hpc_curricular_goals!inner(id,domain_id)").eq("id", competencyId).eq("curricular_goal_id", curricularGoalId).maybeSingle();
    if (competencyError || !competency || (competency.hpc_curricular_goals as { domain_id?: string } | null)?.domain_id !== domain.id) return Response.json({ error: "Choose an official curricular goal and competency from the selected domain." }, { status: 400 });
    if (abilityId) {
      const { data: ability, error: abilityError } = await db.from("hpc_abilities").select("id").eq("id", abilityId).eq("framework_version_id", domain.framework_version_id).maybeSingle();
      if (abilityError || !ability) return Response.json({ error: "Choose an ability from the approved framework." }, { status: 400 });
    }
    const { data, error: mappingError } = await db.from("hpc_competency_mappings").insert({ school_id: profile.school_id, learner_profile_id: learner.id, framework_version_id: domain.framework_version_id, domain_id: domain.id, curricular_goal_id: curricularGoalId, competency_id: competencyId, ability_id: abilityId || null, mapping_note: String(body.mappingNote || "").trim() || null, mapping_status: "teacher_review_required", created_by: profile.id }).select("id,mapping_note,mapping_status,created_at,hpc_domains(label,code),hpc_curricular_goals(code,label),hpc_competencies(code,label),hpc_learning_outcomes(code,label),hpc_abilities(label)").single();
    if (mappingError) return Response.json({ error: mappingError.message }, { status: 500 });
    return Response.json({ mapping: data }, { status: 201 });
  }
  return Response.json({ error: "Unsupported Prompt 1 action." }, { status: 400 });
}
