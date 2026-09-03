type WorksheetRequestBody = {
  concept?: string;
  concepts?: string[];
  subject?: string;
  grade?: string;
  difficulty?: string;
  template?: string;
  mcqCount?: number;
  subjectiveCount?: number;
  evidenceSummary?: string;
};

type CognitiveLevel = "recall" | "application" | "analysis";

type WorksheetResult = {
  mcqQuestions: { question: string; options: string[]; correctIndex: number; cognitiveLevel: CognitiveLevel; concept?:string }[];
  subjectiveQuestions: { question: string; modelAnswer: string; cognitiveLevel: CognitiveLevel; concept?:string }[];
};

// Worksheet generation is analysis/content-generation, so it goes through OpenAI —
// consistent with grading analysis. Mistral is reserved for OCR elsewhere in this app.
export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorized();
    const body = (await request.json()) as WorksheetRequestBody;
    const {
      concept = "the target concept",
      subject = "General",
      grade = "Not supplied",
      difficulty = "Mixed",
      template = "Guided recovery",
      mcqCount = 4,
      subjectiveCount = 2,
    } = body;


    const systemPrompt =
      "You are a teacher's assistant that writes targeted practice worksheets covering every supplied learning gap. " +
      "Respond with ONLY a single JSON object, no markdown fences, no commentary, matching exactly this shape: " +
      '{"mcqQuestions": [{"question": string, "options": [string, string, string, string], "correctIndex": number, "cognitiveLevel": "recall"|"application"|"analysis", "concept": string}], ' +
      '"subjectiveQuestions": [{"question": string, "modelAnswer": string, "cognitiveLevel": "recall"|"application"|"analysis", "concept": string}]}. ' +
      "correctIndex is 0-based. Distribute questions as evenly as possible across ALL supplied concepts; every concept must appear at least once and every question must carry its concept label. " +
      "cognitiveLevel must reflect what the question actually demands: \"recall\" for remembering a fact/definition/procedure, " +
      "\"application\" for using the concept to solve a standard problem, \"analysis\" for multi-step reasoning, comparison, or justifying an answer. " +
      "Aim for a realistic mix across the set rather than defaulting every question to the same level.";

    const userPrompt =
      `Subject: ${subject}\nClass: ${grade}\n` +
      `All target learning gaps: ${(body.concepts?.length?body.concepts:[concept]).join(" | ")}\n` +
      `Worksheet style: ${template}\n` +
      `Difficulty: ${difficulty}\n` +
      `Number of multiple-choice questions: ${mcqCount}\n` +
      `Number of subjective questions: ${subjectiveCount}\n\n` +
      `Evidence from the uploaded question paper, model answers, answer sheet and grading:\n${(body.evidenceSummary || "No additional evidence supplied").slice(0,12000)}\n\n` +
      "Generate the worksheet content following the required JSON shape exactly, with the requested question counts. Ground the questions in this evidence and do not switch to an unrelated subject.";

    const startedAt = Date.now();
    // Through the Django proxy: this app no longer holds an OpenAI key.
    const completion = await complete(request, {
      messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      response_format: { type: "json_object" },
    });
    const openaiMs = Date.now() - startedAt;
const raw = completion.content;
    if (!raw || typeof raw !== "string") {
      return Response.json({ error: "The content-generation service returned an empty response." }, { status: 502 });
    }

    let parsed: WorksheetResult;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return Response.json({ error: "The content-generation service returned an invalid response.", raw }, { status: 502 });
    }

    const levels: CognitiveLevel[] = ["recall", "application", "analysis"];
    const normalizeLevel = (v: unknown): CognitiveLevel =>
      levels.includes(v as CognitiveLevel) ? (v as CognitiveLevel) : "application";
    const requestedTopics = body.concepts?.map(x => x.trim()).filter(Boolean) || [(body.concept || "Teacher-selected learning gap").trim()];
    parsed.mcqQuestions = (parsed.mcqQuestions || []).map((q, index) => ({
      ...q,
      cognitiveLevel: normalizeLevel(q.cognitiveLevel),
      concept: requestedTopics[index % requestedTopics.length],
    }));
    parsed.subjectiveQuestions = (parsed.subjectiveQuestions || []).map((q, index) => ({
      ...q,
      cognitiveLevel: normalizeLevel(q.cognitiveLevel),
      concept: requestedTopics[(parsed.mcqQuestions.length + index) % requestedTopics.length],
    }));

    return Response.json({ ...parsed, timing: [{ provider: "openai", ms: openaiMs, ok: true }] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json({ error: message }, { status: 500 });
  }
}
import { getAuthenticatedUser, unauthorized } from "../../../lib/supabase-auth";
import { complete } from "../../../lib/ai-proxy";
