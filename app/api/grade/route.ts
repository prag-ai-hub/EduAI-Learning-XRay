import { OPENAI_MODEL } from "../../../lib/openai";
import { getAuthenticatedUser, unauthorized } from "../../../lib/supabase-auth";

type GradeRequest = {
  subject?: string; className?: string; studentName?: string; fileName?: string; maxMarks?: number;
  answerKey?: string; rubric?: string; ocrText?: string; questionPaperText?: string;
  questionPaperName?: string; markingSchemeText?: string; markingSchemeName?: string;
  modelAnswerText?: string; modelAnswerName?: string;
  documentRole?: string;
  reanalysisReason?: string;
  operationKey?: string;
};

const CBSE_DIAGNOSTIC_PROMPT = `
You are an expert CBSE academic diagnostician, subject teacher, examiner, curriculum specialist and personalised-learning coach.
Analyse only teacher-validated OCR text. Mistral has already completed extraction; you never receive or inspect the raw files.

Focus ONLY on questions that are completely wrong, partially correct, unanswered, incomplete, or received fewer than maximum marks.
Do not create learning gaps from fully correct answers. Refer to correct work only when it proves an error is isolated or distinguishes knowledge from execution.
Use the marking scheme/model answer as the primary reference when supplied. Never invent unreadable or missing text, marks, question numbers, teacher comments or student intent.
When the uploaded evidence is explicitly classified as a teacher-graded answer sheet, treat a clearly visible teacher-awarded total in the validated OCR as authoritative ground truth. Return that total as score and use the answer analysis only to explain it. If no reliable teacher total is visible, grade normally and say so in feedback.

For every mark-losing response identify: question number; maximum and awarded marks when visible; chapter/unit; topic and exact micro-concept; expected knowledge/method; what the student wrote; exact point of mark loss; error category; root cause; prerequisite weakness; whether isolated or repeated; future impact; confidence; corrective sequence; practice; and mastery check.
Use simple English suitable for a Class 9-10 student. Prefer short, clear sentences. Explain difficult terms and use a small example when useful without losing academic accuracy.
Classify errors as conceptual, procedural, application, reasoning, interpretation, factual recall, calculation, language/expression, answer completeness, presentation/exam technique, execution, or supported time-management inference.
Trace both paths: observed error -> immediate gap -> misconception/skill weakness -> prerequisite gap -> learning consequence; and current concept -> prerequisite concept -> earlier-class foundation -> root learning gap. Move to an earlier class only when the answer evidence supports it. State the recommended learning level and remediation order from foundation to current concept.
Combine errors with the same root cause while citing every supporting question number. Use CBSE/NCERT and subject-specific terminology. Diagnose rather than judge.

Determine maxMarks dynamically from the question paper: prefer an explicit total, otherwise sum question marks, and only then use the declared fallback. Apply reasonable partial credit.
Return ONLY JSON:
{"score":number,"maxMarks":number,"questions":[{"id":string,"label":string,"pageNumber":number,"attemptState":"attempted"|"not_attempted"|"excluded","awardedMarks":number,"maxMarks":number,"allowedIncrement":number,"evidence":string,"rationale":string,"confidence":number,"criteria":[{"id":string,"label":string,"awardedMarks":number,"maxMarks":number,"evidence":string,"rationale":string}]}],"gaps":[{"concept":string,"mastery":number,"finding":string,"misconception":string,"evidence":string,"prerequisiteConcept":string,"foundationGap":string,"recommendedLevel":string,"remediationSequence":[string],"rework":string,"severity":"priority"|"developing"}],"feedback":string}
The questions array is compulsory and must account for every printed question or valid alternative in the question paper. Use stable IDs such as q1, q2a and q8b. Every question must include pageNumber, using the --- Page n --- divider that contains that student's response; when an answer spans pages, use its first page. Question maximum marks must sum exactly to maxMarks. Use excluded only for a valid unselected alternative. Every attempted answer needs a concise evidence excerpt. Criterion marks must sum to the question award when criteria are returned. These are AI proposals for evaluator review, never final marks.
Each gap must be genuine and evidence-supported. "evidence" cites question number(s), marks when visible, and a concise paraphrase of the response. "finding" names the smallest teachable gap and error category. "misconception" gives root cause and confidence. "rework" gives prerequisites, sequence, practice mix, mistake-prevention check and measurable mastery standard. Order foundational gaps first.`;

export async function POST(request: Request) {
  let chargedOperation = "";
  // Hoisted so the catch block can refund: `user` is scoped to the try.
  let chargedUserId = "";
  let credit: any = null;
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorized();
    chargedUserId = user.id;
    const body = (await request.json()) as GradeRequest;
    if (!body.ocrText?.trim()) return Response.json({ error: "Validate the answer-sheet OCR text before analysis." }, { status: 400 });
    if (!body.questionPaperText?.trim()) return Response.json({ error: "A validated question paper is compulsory before learning-gap analysis." }, { status: 400 });
    chargedOperation=String(body.operationKey||"").trim();
    if(!/^[a-zA-Z0-9:_-]{8,180}$/.test(chargedOperation))return Response.json({error:"A valid analysis operation key is required."},{status:400});
    // Verified BEFORE any credit is charged. Every early `return` past this point
    // would exit the try block without reaching the catch that refunds, so the
    // teacher would silently lose a credit for work that never ran.
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return Response.json({ error: "OPENAI_API_KEY is not configured." }, { status: 500 });
    const {getSupabaseServer}=await import("../../../lib/supabase-server");
    const db=getSupabaseServer();
    const creditResult=await db.rpc("consume_credit",{p_user_id:chargedUserId,p_operation_key:chargedOperation,p_reference:`${body.studentName||"Student"} · ${body.fileName||"answer sheet"}`,p_cost:Number(process.env.ANALYSIS_CREDIT_COST||1)});
    credit=creditResult.data;
    if(creditResult.error){
      const message=creditResult.error.message||"";
      const missingCreditFunction=creditResult.error.code==="PGRST202"||(/consume_credit/i.test(message)&&/schema cache|could not find the function/i.test(message));
      if(missingCreditFunction){
        console.warn("Credit charging is unavailable because the consume_credit migration has not reached the Supabase schema cache.");
        chargedOperation="";
        credit=null;
      }else{
        const insufficient=/insufficient/i.test(message);
        return Response.json({error:insufficient?"You do not have enough credits to analyse this assessment. Please contact your administrator.":message},{status:insufficient?402:400});
      }
    }
    const subject = body.subject?.trim() || "General";
    const studentName = body.studentName?.trim() || "Student";
    const fallbackMarks = Number(body.maxMarks) || 10;
    const userPrompt = `Student: ${studentName}
Subject: ${subject}
Class: ${body.className?.trim() || "Not supplied"}
Answer sheet file: ${body.fileName || "answer sheet"}
Answer sheet classification: ${body.documentRole || "not supplied"}
Declared maximum marks (fallback only): ${fallbackMarks}

Teacher-validated question paper OCR:
"""
${body.questionPaperText?.trim() || "(not supplied)"}
"""

Teacher-validated marking scheme OCR (PRIMARY REFERENCE):
"""
${body.markingSchemeText?.trim() || body.answerKey?.trim() || "(not supplied)"}
"""

Teacher-validated model answer paper OCR:
"""
${body.modelAnswerText?.trim() || "(not supplied)"}
"""

Typed rubric:
"""
${body.rubric?.trim() || "(not supplied)"}
"""

Teacher reason for reanalysis:
"""
${body.reanalysisReason?.trim() || "(first analysis — no reanalysis reason)"}
"""

Teacher-validated student answer-sheet OCR:
"""
${body.ocrText.trim()}
"""

Produce the CBSE diagnostic result and exclude fully correct questions from gaps. When a reanalysis reason is supplied, explicitly reconsider that feedback while remaining grounded in the validated evidence.`;
    const startedAt = Date.now();
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{ role: "system", content: CBSE_DIAGNOSTIC_PROMPT }, { role: "user", content: userPrompt }],
        response_format: { type: "json_object" },
      }),
    });
    const ms = Date.now() - startedAt;
    if (!response.ok) throw new Error(`Learning analysis failed: ${await response.text()}`);
    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content;
    if (typeof raw !== "string") throw new Error("The learning-analysis service returned no diagnostic analysis.");
    let result;
    try { result = JSON.parse(raw); } catch { throw new Error("The learning-analysis service returned invalid diagnostic data."); }
    const maxMarks = Number(result.maxMarks);
    if (!Number.isFinite(maxMarks) || maxMarks <= 0 || maxMarks > 10000) throw new Error("The assessment total marks could not be determined reliably.");
    const gaps = (Array.isArray(result.gaps) ? result.gaps : [])
      .filter((gap: any) => gap && typeof gap.concept === "string" && Number(gap.mastery) < 100)
      .map((gap: any) => ({ ...gap, mastery: Math.max(0, Math.min(99, Number(gap.mastery) || 0)) }));
    const questions = (Array.isArray(result.questions) ? result.questions : []).map((question: any, index: number) => ({
      id: String(question.id || `q${index + 1}`).trim(),
      label: String(question.label || question.id || `Question ${index + 1}`).trim(),
      pageNumber: Math.max(1, Math.floor(Number(question.pageNumber) || 1)),
      attemptState: ["attempted", "not_attempted", "excluded"].includes(question.attemptState) ? question.attemptState : "attempted",
      awardedMarks: Number(question.awardedMarks) || 0,
      maxMarks: Number(question.maxMarks) || 0,
      allowedIncrement: [0.25, 0.5, 1].includes(Number(question.allowedIncrement)) ? Number(question.allowedIncrement) : 0.5,
      evidence: String(question.evidence || ""),
      rationale: String(question.rationale || ""),
      confidence: Math.max(0, Math.min(1, Number(question.confidence) || 0)),
      aiDisposition: "accepted",
      reviewed: false,
      criteria: Array.isArray(question.criteria) ? question.criteria.map((criterion: any, criterionIndex: number) => ({
        id: String(criterion.id || `${question.id || `q${index + 1}`}.c${criterionIndex + 1}`),
        label: String(criterion.label || `Criterion ${criterionIndex + 1}`),
        awardedMarks: Number(criterion.awardedMarks) || 0,
        maxMarks: Number(criterion.maxMarks) || 0,
        evidence: String(criterion.evidence || ""),
        rationale: String(criterion.rationale || ""),
      })) : [],
    }));
    if (!questions.length) throw new Error("The grading proposal did not contain question-level decisions.");
    const proposedMaximum = questions.reduce((sum: number, question: any) => sum + question.maxMarks, 0);
    if (Math.abs(proposedMaximum - maxMarks) > 0.001) throw new Error("The question-level maximum marks did not match the assessment total.");
    return Response.json({
      score: Math.max(0, Math.min(maxMarks, Number(result.score) || 0)), maxMarks, questions, gaps, feedback: result.feedback,
      timing: [{ provider: "openai", ms, ok: true }], credits: credit?.[0]||null,
      gradingEvidence: {
        questionPaper: body.questionPaperName || null,
        markingScheme: body.markingSchemeName || (body.answerKey ? "Typed marking scheme" : null),
        modelAnswer: body.modelAnswerName || null,
        totalMarksSource: "validated-question-paper-ocr",
        analysisScope: "wrong-partial-unanswered-only",
      },
    });
  } catch (error) {
    if(chargedOperation&&chargedUserId){try{const {getSupabaseServer}=await import("../../../lib/supabase-server");await getSupabaseServer().rpc("refund_credit",{p_user_id:chargedUserId,p_operation_key:chargedOperation,p_reason:error instanceof Error?error.message:"Analysis failed"})}catch{}}
    return Response.json({ error: error instanceof Error ? error.message : "Unexpected error" }, { status: 500 });
  }
}
