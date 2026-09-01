import { getAuthorizedProfile } from "../../../../lib/authorization";
import { validateEvaluationSubmission, sha256, type EvaluationSubmission } from "../../../../lib/evaluator-grading";
import { getSupabaseServer } from "../../../../lib/supabase-server";

export async function POST(request: Request) {
  try {
    const profile = await getAuthorizedProfile(request);
    if (profile instanceof Response) return profile;
    if (!profile.school_id) return Response.json({ error: "Your profile is not assigned to a school." }, { status: 403 });
    const submission = (await request.json()) as EvaluationSubmission;
    const validation = validateEvaluationSubmission(submission);
    if (!validation.valid) return Response.json({ error: "Evaluation is incomplete.", errors: validation.errors }, { status: 422 });

    const db = getSupabaseServer();
    const existing = await db
      .from("evaluation_versions")
      .select("id,version_number,total_awarded,total_max,content_hash,status")
      .eq("school_id", profile.school_id)
      .eq("evaluator_id", profile.id)
      .eq("idempotency_key", submission.idempotencyKey)
      .maybeSingle();
    const foundationMissing = Boolean(existing.error && (existing.error.code === "42P01" || existing.error.code === "PGRST205" || /evaluation_versions/i.test(existing.error.message || "")));
    if (existing.error && !foundationMissing) throw new Error(existing.error.message);
    if (existing.data) return Response.json({ evaluation: existing.data, replayed: true });

    // Compatibility bridge for schools publishing before the additive migration is applied.
    // The append-only audit record remains immutable and idempotent; the migration upgrades
    // new submissions to the dedicated normalized version table without breaking the pilot.
    if (foundationMissing) {
      const prior = await db.from("audit_events").select("detail_json").eq("school_id", profile.school_id).eq("action", "evaluation.submitted").contains("detail_json", { idempotencyKey: submission.idempotencyKey }).limit(1).maybeSingle();
      if (prior.error) throw new Error(prior.error.message);
      if (prior.data?.detail_json?.evaluation) return Response.json({ evaluation: prior.data.detail_json.evaluation, replayed: true, compatibilityStore: true });
      const contentHash = await sha256(validation.canonical);
      const evaluation = { id: crypto.randomUUID(), version_number: 1, total_awarded: validation.totalAwarded, total_max: validation.totalMaximum, content_hash: contentHash, status: "submitted" };
      const audit = await db.from("audit_events").insert({
        id: crypto.randomUUID(), school_id: profile.school_id, actor_id: profile.id,
        action: "evaluation.submitted", entity_type: "evaluation_version", entity_id: evaluation.id,
        detail_json: { idempotencyKey: submission.idempotencyKey, assessmentId: submission.assessmentId, fileId: submission.fileId, evaluation, snapshot: JSON.parse(validation.canonical), compatibilityStore: true },
      });
      if (audit.error) throw new Error(audit.error.message);
      return Response.json({ evaluation, replayed: false, compatibilityStore: true }, { status: 201 });
    }

    const assessment = await db.from("assessments").select("id,school_id,version").eq("id", submission.assessmentId).maybeSingle();
    if (assessment.error) throw new Error(assessment.error.message);
    if (assessment.data && assessment.data.school_id !== profile.school_id) return Response.json({ error: "This assessment belongs to another school." }, { status: 403 });
    if (assessment.data && Number(assessment.data.version) !== submission.assessmentVersion) return Response.json({ error: "The assessment version changed. Reload it before submitting." }, { status: 409 });

    const contentHash = await sha256(validation.canonical);
    const latest = await db
      .from("evaluation_versions")
      .select("version_number")
      .eq("school_id", profile.school_id)
      .eq("assessment_id", submission.assessmentId)
      .eq("file_id", submission.fileId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest.error) throw new Error(latest.error.message);
    const id = crypto.randomUUID();
    const versionNumber = Number(latest.data?.version_number || 0) + 1;
    const row = {
      id,
      school_id: profile.school_id,
      assessment_id: submission.assessmentId,
      assessment_version: submission.assessmentVersion,
      file_id: submission.fileId,
      student_name: submission.studentName.trim(),
      evaluator_id: profile.id,
      version_number: versionNumber,
      status: "submitted",
      total_awarded: validation.totalAwarded,
      total_max: validation.totalMaximum,
      content_hash: contentHash,
      idempotency_key: submission.idempotencyKey,
      snapshot_json: JSON.parse(validation.canonical),
      submitted_at: new Date().toISOString(),
    };
    const saved = await db.from("evaluation_versions").insert(row).select("id,version_number,total_awarded,total_max,content_hash,status").single();
    if (saved.error) throw new Error(saved.error.message);
    const audit = await db.from("audit_events").insert({
      id: crypto.randomUUID(), school_id: profile.school_id, actor_id: profile.id,
      action: "evaluation.submitted", entity_type: "evaluation_version", entity_id: id,
      detail_json: { assessmentId: submission.assessmentId, fileId: submission.fileId, versionNumber, contentHash },
    });
    if (audit.error) throw new Error(audit.error.message);
    return Response.json({ evaluation: saved.data, replayed: false }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Evaluation submission failed." }, { status: 500 });
  }
}
