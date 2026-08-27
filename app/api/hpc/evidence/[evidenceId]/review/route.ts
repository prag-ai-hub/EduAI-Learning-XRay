import { getAuthorizedProfile } from "../../../../../../lib/authorization";
import { getSupabaseServer } from "../../../../../../lib/supabase-server";

export async function POST(request: Request, { params }: { params: Promise<{ evidenceId: string }> }) {
  const profile = await getAuthorizedProfile(request); if (profile instanceof Response) return profile;
  if (!profile.school_id) return Response.json({ error: "A school profile is required." }, { status: 403 });
  const { evidenceId } = await params, body = await request.json() as Record<string, unknown>;
  const reviewStatus = String(body.reviewStatus || "");
  if (!["approved","excluded"].includes(reviewStatus)) return Response.json({ error: "Choose approved or excluded." }, { status: 400 });
  const { data, error } = await getSupabaseServer().from("hpc_evidence").update({ review_status: reviewStatus, reviewed_by: profile.id, reviewed_at: new Date().toISOString(), sufficiency_status: reviewStatus === "approved" ? String(body.sufficiencyStatus || "limited") : "teacher_review_required" }).eq("id", evidenceId).eq("school_id", profile.school_id).select("id,review_status,sufficiency_status").maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 }); if (!data) return Response.json({ error: "Evidence not found." }, { status: 404 });
  return Response.json({ evidence: data });
}
