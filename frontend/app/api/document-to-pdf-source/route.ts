import { extractDocumentText } from "../../../lib/document-text";
import { getAuthenticatedUser, unauthorized } from "../../../lib/supabase-auth";

type ConversionBody = {
  name?: string;
  mimeType?: string;
  base64?: string;
};

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorized();
    const body = await request.json() as ConversionBody;
    if (!body.name || !body.base64) {
      return Response.json({ error: "A source document is required." }, { status: 400 });
    }
    const extracted = await extractDocumentText({
      name: body.name,
      mimeType: body.mimeType || "application/octet-stream",
      base64: body.base64,
    }, process.env.MISTRAL_API_KEY);
    if (!extracted.text?.trim()) {
      return Response.json({ error: "No readable content was found in this document." }, { status: 422 });
    }
    return Response.json({ text: extracted.text });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Document conversion failed.",
    }, { status: 500 });
  }
}
