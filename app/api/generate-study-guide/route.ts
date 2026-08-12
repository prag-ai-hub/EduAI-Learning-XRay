type StudyGuideRequest = {
  subject?: string;
  concept?: string;
  studentName?: string;
  mastery?: number;
  feedback?: string;
  ocrText?: string;
  evidenceFiles?: string[];
  gaps?: {concept:string;mastery:number;finding?:string;misconception?:string;evidence?:string;prerequisiteConcept?:string;foundationGap?:string;recommendedLevel?:string;remediationSequence?:string[];rework?:string}[];
};

type StudyGuide = {
  title: string;
  overview: string;
  topics: {
    concept:string;
    mastery:number;
    diagnosis:string;
    learningObjective:string;
    explanation:string;
    workedExample:string;
    practiceSteps:string[];
    checkForUnderstanding:string[];
  }[];
};

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorized();
    const body = (await request.json()) as StudyGuideRequest;
    const subject = body.subject?.trim() || "General";
    const concept = body.concept?.trim() || "the identified learning gaps";
    const gaps=(body.gaps||[]).sort((a,b)=>a.mastery-b.mastery);
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return Response.json({ error: "OPENAI_API_KEY is not configured." }, { status: 500 });

    const prompt =
      `Subject: ${subject}\nStudent: ${body.studentName || "Student"}\nPriority learning gap: ${concept}\n` +
      `Mastery: ${body.mastery ?? "unknown"}%\nGrading feedback: ${body.feedback || "No additional feedback"}\n` +
      `Answer-sheet OCR evidence:\n${(body.ocrText || "").slice(0, 12000) || "No OCR excerpt available"}\n\n` +
      `Uploaded source set:\n${(body.evidenceFiles || []).join("\n") || "No source filenames supplied"}\n\n` +
      `All diagnosed learning gaps, in priority order:\n${gaps.map((gap,index)=>`${index+1}. ${gap.concept} (${gap.mastery}% mastery)\nFinding: ${gap.finding||""}\nMisconception: ${gap.misconception||""}\nEvidence: ${gap.evidence||""}\nRework: ${gap.rework||""}`).join("\n\n")||concept}\n\n` +
      "Create a complete, editable study guide with one topic section for EVERY listed gap. Follow the evidence-supported learning dependency: foundation, then prerequisite, then current concept, then a short check. Include lower-class material only when the diagnostic evidence supports it. Use simple English for a Class 9-10 student, short clear sentences, explained terms, worked examples, and 2-3 practice questions at each necessary step. " +
      "Do not introduce mathematics examples unless the subject or evidence is mathematical.";

    const startedAt = Date.now();
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.6-sol",
        messages: [
          {
            role: "system",
            content:
              "You create academically accurate, evidence-based remedial study guides written so a Class 9-10 student can understand them without an adult explaining difficult language. Return only JSON with this exact shape: " +
              '{"title":string,"overview":string,"topics":[{"concept":string,"mastery":number,"diagnosis":string,"learningObjective":string,"explanation":string,"workedExample":string,' +
              '"practiceSteps":[string,string,string],"checkForUnderstanding":[string,string,string]}]}. Include exactly one topic object for every supplied learning gap.',
          },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      }),
    });
    const openaiMs = Date.now() - startedAt;
    if (!response.ok) {
      return Response.json(
        { error: await response.text(), timing: [{ provider: "openai", ms: openaiMs, ok: false }] },
        { status: response.status }
      );
    }

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content;
    if (typeof raw !== "string") return Response.json({ error: "The learning-analysis service returned an empty response." }, { status: 502 });

    let guide: StudyGuide;
    try {
      guide = JSON.parse(raw) as StudyGuide;
    } catch {
      return Response.json({ error: "The learning-analysis service returned invalid study-guide data." }, { status: 502 });
    }
    return Response.json({ guide, timing: [{ provider: "openai", ms: openaiMs, ok: true }] });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unexpected error" }, { status: 500 });
  }
}
import { getAuthenticatedUser, unauthorized } from "../../../lib/supabase-auth";
