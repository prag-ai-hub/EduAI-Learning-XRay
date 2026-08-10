import { getAuthenticatedUser, unauthorized } from "../../../lib/supabase-auth";
import { extractDocumentText } from "../../../lib/document-text";

type OcrDocument = { id: "answerSheet" | "questionPaper" | "markingScheme" | "modelAnswer"; name: string; base64: string; mimeType: string };

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorized();
    const { documents = [] } = await request.json() as { documents?: OcrDocument[] };
    if (!Array.isArray(documents) || !documents.some(document => document.id === "answerSheet" && document.base64)) {
      return Response.json({ error: "An answer sheet is required for OCR." }, { status: 400 });
    }
    if (!documents.some(document => document.id === "questionPaper" && document.base64)) {
      return Response.json({ error: "A question paper is compulsory for learning-gap analysis." }, { status: 400 });
    }
    const apiKey = process.env.MISTRAL_API_KEY;
    const results = [];
    for (const document of documents.filter(item => item?.base64)) {
      const extracted = await extractDocumentText(document, apiKey);
      results.push({ id: document.id, name: document.name, text: extracted.text, ms: extracted.ms, provider: extracted.provider });
    }
    return Response.json({
      documents: Object.fromEntries(results.map(result => [result.id, { name: result.name, text: result.text }])),
      timing: results.some(result => result.provider === "mistral")
        ? [{ provider: "mistral", ms: results.reduce((sum, result) => sum + result.ms, 0), ok: true }]
        : [],
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unexpected OCR error" }, { status: 500 });
  }
}
