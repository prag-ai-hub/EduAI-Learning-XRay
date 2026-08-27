import { getAuthorizedProfile } from "../../../../lib/authorization";
import { getSupabaseServer } from "../../../../lib/supabase-server";

export async function GET(request: Request) {
  const profile = await getAuthorizedProfile(request);
  if (profile instanceof Response) return profile;
  if (!profile.school_id) return Response.json({ error: "A school profile is required for Holistic Progress." }, { status: 403 });

  const db = getSupabaseServer();
  const [{ data: settings, error: settingsError }, { data: frameworks, error: frameworksError }] = await Promise.all([
    db.from("hpc_school_settings").select("enabled,updated_at").eq("school_id", profile.school_id).maybeSingle(),
    db.from("hpc_framework_versions").select("id,framework_code,version_label,source_name,source_reference,source_published_at").eq("status", "approved").order("source_published_at", { ascending: false }),
  ]);
  if (settingsError || frameworksError) {
    return Response.json({ error: settingsError?.message || frameworksError?.message || "Unable to load Holistic Progress foundation." }, { status: 500 });
  }
  const framework = frameworks?.[0];
  const [sectionsResult, abilitiesResult, levelsResult, domainsResult] = framework ? await Promise.all([
    db.from("hpc_stage_templates").select("id,hpc_template_sections(section_code,title,sort_order,required)").eq("framework_version_id", framework.id).eq("stage_code", "middle").maybeSingle(),
    db.from("hpc_abilities").select("id,code,label").eq("framework_version_id", framework.id).order("label"),
    db.from("hpc_performance_levels").select("id,code,label,score_from,score_to,sort_order").eq("framework_version_id", framework.id).order("sort_order"),
    db.from("hpc_domains").select("code,label").eq("framework_version_id", framework.id).order("label"),
  ]) : [null, null, null, null];
  const detailError = sectionsResult?.error || abilitiesResult?.error || levelsResult?.error || domainsResult?.error;
  if (detailError) return Response.json({ error: detailError.message || "Unable to load the approved HPC framework." }, { status: 500 });
  return Response.json({
    enabled: settings?.enabled === true,
    frameworkReady: Boolean(framework),
    approvedFrameworkCount: frameworks?.length || 0,
    framework: framework ? {
      code: framework.framework_code,
      versionLabel: framework.version_label,
      sourceName: framework.source_name,
      sourceReference: framework.source_reference,
      sourcePublishedAt: framework.source_published_at,
      sections: (sectionsResult?.data?.hpc_template_sections || []).sort((left, right) => left.sort_order - right.sort_order),
      abilities: abilitiesResult?.data || [],
      performanceLevels: levelsResult?.data || [],
      domains: domainsResult?.data || [],
    } : null,
  });
}
