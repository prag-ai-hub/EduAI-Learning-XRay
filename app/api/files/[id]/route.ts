import { getSupabaseServer, SUPABASE_FILES_BUCKET } from "../../../../lib/supabase-server";
import { getAuthenticatedUser, unauthorized } from "../../../../lib/supabase-auth";

function fileId(request: Request) {
  return decodeURIComponent(new URL(request.url).pathname.split("/").pop() || "");
}

export async function PUT(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorized();
    const id = fileId(request);
    if (!id || id.length > 300) return Response.json({ error: "Invalid file id." }, { status: 400 });
    const blob = await request.blob();
    if (!blob.size || blob.size > 10 * 1024 * 1024) {
      return Response.json({ error: "Files must be between 1 byte and 10 MB." }, { status: 413 });
    }
    const { error } = await getSupabaseServer().storage
      .from(SUPABASE_FILES_BUCKET)
      .upload(`${user.id}/uploads/${id}`, await blob.arrayBuffer(), {
        contentType: request.headers.get("content-type") || "application/octet-stream",
        upsert: true,
      });
    if (error) throw error;
    return Response.json({ ok: true, size: blob.size });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "File upload failed" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorized();
    const { data, error } = await getSupabaseServer().storage
      .from(SUPABASE_FILES_BUCKET)
      .download(`${user.id}/uploads/${fileId(request)}`);
    if (error) return Response.json({ error: "File not found." }, { status: 404 });
    return new Response(data, {
      headers: {
        "content-type": data.type || "application/octet-stream",
        "cache-control": "private, max-age=60",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "File download failed" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorized();
    const { error } = await getSupabaseServer().storage
      .from(SUPABASE_FILES_BUCKET)
      .remove([`${user.id}/uploads/${fileId(request)}`]);
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "File deletion failed" }, { status: 500 });
  }
}
