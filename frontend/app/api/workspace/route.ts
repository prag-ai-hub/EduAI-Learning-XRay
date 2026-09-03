import { getSupabaseServer } from "../../../lib/supabase-server";
import { getAuthenticatedUser, unauthorized } from "../../../lib/supabase-auth";

const MAX_STATE_BYTES = 4 * 1024 * 1024;

function stateForDatabase(value: any) {
  if (!value || typeof value !== "object") return value;
  return {
    ...value,
    assessments: Array.isArray(value.assessments)
      ? value.assessments.map(({ grade, className, ...assessment }: any) => ({
          ...assessment,
          className: className ?? grade ?? "",
        }))
      : value.assessments,
  };
}

function stateForClient(value: any) {
  if (!value || typeof value !== "object") return value;
  return {
    ...value,
    assessments: Array.isArray(value.assessments)
      ? value.assessments.map(({ className, grade, ...assessment }: any) => ({
          ...assessment,
          grade: className ?? grade ?? "",
        }))
      : value.assessments,
  };
}

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorized();
    const { data, error } = await getSupabaseServer()
      .from("workspace_snapshots")
      .select("state_json, revision, updated_at")
      .eq("workspace_id", `teacher:${user.id}`)
      .maybeSingle();
    if (error) throw error;
    if (!data) return Response.json({ state: null, revision: 0 });
    return Response.json({ state: stateForClient(data.state_json), revision: data.revision, updatedAt: data.updated_at });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Database read failed" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorized();
    const body = await request.json() as { state?: unknown; revision?: unknown };
    if (!body.state || typeof body.state !== "object") {
      return Response.json({ error: "A workspace state object is required." }, { status: 400 });
    }
    // The revision the client last read. Omitting it keeps the old
    // last-write-wins behaviour, so a stale client keeps working.
    const expectedRevision = Number.isFinite(Number(body.revision)) && Number(body.revision) > 0
      ? Number(body.revision)
      : null;
    const persistedState = stateForDatabase(body.state);
    const serialized = JSON.stringify(persistedState);
    if (new TextEncoder().encode(serialized).byteLength > MAX_STATE_BYTES) {
      return Response.json({ error: "Workspace state exceeds the 4 MB storage limit." }, { status: 413 });
    }
    const { data, error } = await getSupabaseServer().rpc("save_workspace_snapshot", {
      p_workspace_id: `teacher:${user.id}`,
      p_state_json: persistedState,
      p_expected_revision: expectedRevision,
    });
    if (error) {
      // Another device wrote since this client last read. Overwriting would
      // silently discard that work, so the client is told to reload instead.
      if (error.code === "40001" || /workspace_revision_conflict/.test(error.message || "")) {
        const current = await getSupabaseServer()
          .from("workspace_snapshots").select("revision")
          .eq("workspace_id", `teacher:${user.id}`).maybeSingle();
        return Response.json({
          error: "This workspace was changed on another device. Reload to continue from the latest version.",
          conflict: true,
          revision: current.data?.revision ?? null,
        }, { status: 409 });
      }
      throw error;
    }
    return Response.json({ ok: true, revision: data });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Database write failed" }, { status: 500 });
  }
}
