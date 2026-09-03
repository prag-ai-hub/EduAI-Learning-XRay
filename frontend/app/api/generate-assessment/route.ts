import { extractDocumentText, type TextDocument } from "../../../lib/document-text";
import { complete } from "../../../lib/ai-proxy";
import { getAuthenticatedUser, unauthorized } from "../../../lib/supabase-auth";

type GenerateAssessmentBody = {
  title?: string;
  type?: string;
  className?: string;
  subject?: string;
  maxMarks?: number;
  blueprint?: TextDocument;
};

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorized();
    const body = await request.json() as GenerateAssessmentBody;
    const title = body.title?.trim();
    const subject = body.subject?.trim();
    const className = body.className?.trim();
    const maxMarks = Number(body.maxMarks);
    if (!title || !subject || !className || !Number.isFinite(maxMarks) || maxMarks < 1) {
      return Response.json({ error: "Title, class, subject and maximum marks are required." }, { status: 400 });
    }
    let blueprintText = "";
    let ocrMs = 0;
    if (body.blueprint?.base64) {
      const extracted = await extractDocumentText(body.blueprint, request);
      blueprintText = extracted.text;
      ocrMs = extracted.ms;
    }
    const prompt = `Create a complete ${body.type || "assessment"} for:
Title: ${title}
Class: ${className}
Subject: ${subject}
Total marks: ${maxMarks}

Optional teacher blueprint:
"""
${blueprintText.slice(0,16000) || "No blueprint supplied. Use a balanced, age-appropriate assessment structure."}
"""

Return ONLY JSON with this exact shape:
{"questionPaperText":string,"markingSchemeText":string,"modelAnswerText":string,"questionCount":number}

The question paper must clearly show instructions, question numbers, marks per question, and total exactly ${maxMarks}. Follow the uploaded blueprint when supplied. The marking scheme must allocate marks question by question and include partial-credit guidance. The model answer must answer every question. Keep all three documents internally consistent and classroom-ready.`;
    const startedAt = Date.now();
    // Through the Django proxy: this app no longer holds an OpenAI key.
    const completion = await complete(request, {
      messages: [
          { role: "system", content: "You are an expert assessment designer. Produce rigorous, age-appropriate assessments and exact marking references." },
          { role: "user", content: prompt },
        ],
      response_format: { type: "json_object" },
    });
    const openaiMs = Date.now() - startedAt;
const raw = completion.content;
    if (typeof raw !== "string") throw new Error("The assessment-generation service returned no content.");
    const generated = JSON.parse(raw);
    if (!generated.questionPaperText || !generated.markingSchemeText || !generated.modelAnswerText) {
      throw new Error("The generated assessment was incomplete.");
    }
    return Response.json({
      ...generated,
      timing: [
        ...(ocrMs ? [{ provider: "mistral", ms: ocrMs, ok: true }] : []),
        { provider: "openai", ms: openaiMs, ok: true },
      ],
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unexpected assessment-generation error" }, { status: 500 });
  }
}
