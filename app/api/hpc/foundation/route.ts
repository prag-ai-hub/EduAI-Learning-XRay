import { getAuthorizedProfile } from "../../../../lib/authorization";
import { getSupabaseServer } from "../../../../lib/supabase-server";

export async function GET(request: Request) {
  const profile = await getAuthorizedProfile(request);
  if (profile instanceof Response) return profile;
  if (!profile.school_id) return Response.json({ error: "A school profile is required for Holistic Progress." }, { status: 403 });

  const db = getSupabaseServer();
  const [{ data: settings, error: settingsError }, { count: approvedFrameworks, error: frameworksError }] = await Promise.all([
    db.from("hpc_school_settings").select("enabled,updated_at").eq("school_id", profile.school_id).maybeSingle(),
    db.from("hpc_framework_versions").select("id", { count: "exact", head: true }).eq("status", "approved"),
  ]);
  if (settingsError || frameworksError) {
    return Response.json({ error: settingsError?.message || frameworksError?.message || "Unable to load Holistic Progress foundation." }, { status: 500 });
  }
  return Response.json({
    enabled: settings?.enabled === true,
    frameworkReady: Number(approvedFrameworks || 0) > 0,
    approvedFrameworkCount: Number(approvedFrameworks || 0),
  });
}
