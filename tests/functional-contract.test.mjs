import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const app = readFileSync(new URL("../app/ui/FunctionalEduAIApp.tsx", import.meta.url), "utf8");
const parentShare = readFileSync(new URL("../app/ui/ParentShareDialog.tsx", import.meta.url), "utf8");
const login = readFileSync(new URL("../app/signin/page.tsx", import.meta.url), "utf8");
const marketing = readFileSync(new URL("../app/ui/MarketingHome.tsx", import.meta.url), "utf8");

test("persists workspace records in cloud storage with an offline cache", () => {
  assert.match(app, /authFetch\("\/api\/workspace"/);
  assert.match(app, /method:"PUT"/);
  assert.match(app, /localStorage\.getItem\(`eduai-xray-offline-cache-v1:\$\{profile\.id\}`\)/);
  assert.match(app, /localStorage\.setItem\(`eduai-xray-offline-cache-v1:\$\{profile\.id\}`/);
  for (const collection of ["students", "resources", "academicYears"]) assert.match(app, new RegExp(`restored\\.${collection}\\|\\|base\\.${collection}`));
});

test("covers the complete teacher improvement cycle", () => {
  for (const step of ["Create assessment", "Upload student work", "Questions & rubric", "AI processing", "Teacher review", "Final approval", "Learning X-Ray", "Intervention", "Follow-up", "Publish grades"]) {
    assert.ok(app.includes(step), `missing teacher step: ${step}`);
  }
});

test("upload accepts every specified demo format and provides recovery controls", () => {
  for (const ext of [".pdf", ".jpg", ".jpeg", ".png", ".heic", ".docx", ".odt", ".md", ".markdown", ".txt", ".rtf", ".json", ".yaml", ".csv", ".xlsx"]) assert.ok(app.includes(ext), `missing ${ext}`);
  for (const control of ["Browse / Choose File", "Pause", "Resume", "Retry failed", "Remove"]) assert.ok(app.includes(control), `missing upload control: ${control}`);
  assert.match(app, /10 MB limit/);
});

test("uploaded files remain discoverable with cloud bytes and an offline cache", () => {
  for (const control of ["Uploaded evidence", "Preview", "Download", "Remove", "Add files"]) assert.ok(app.includes(control), `missing uploaded-file control: ${control}`);
  assert.match(app, /indexedDB\.open\("eduai-learning-xray-files"/);
  assert.match(app, /saveFileBlob\(id,file\)/);
  assert.match(app, /readFileBlob\(file\.id\)/);
  assert.match(app, /authFetch\(`\/api\/files\/\$\{encodeURIComponent\(id\)\}`/);
});

test("teacher modules have persisted, actionable views", () => {
  for (const module of ["Students", "Resources", "Achievements", "Reports", "Settings"]) assert.ok(app.includes(`"${module}"`), `missing ${module}`);
  for (const dialog of ["student-evidence", "worksheet", "grading-settings", "consent-settings", "security-settings"]) assert.ok(app.includes(dialog), `missing dialog ${dialog}`);
});

test("school administration covers users, structure, privacy and access", () => {
  for (const capability of ["Invite user", "Reset password", "Academic years", "School branding", "Privacy & retention", "Support access"]) assert.ok(app.includes(capability), `missing ${capability}`);
});

test("platform administration covers specification areas", () => {
  for (const capability of ["Tenant management", "Usage analytics", "Provider registry", "Model registry", "Routing rules", "Prompt versions", "Feature flags", "System health", "Audit logs"]) assert.ok(app.includes(capability), `missing ${capability}`);
});

test("public controls navigate and legal routes exist", () => {
  assert.doesNotMatch(login, /href="#"/);
  assert.match(login, /Continue with Google/);
  assert.match(login, /Continue with Microsoft/);
  assert.match(login, /Use email and password/);
  assert.ok(existsSync(new URL("../app/privacy/page.tsx", import.meta.url)));
  assert.ok(existsSync(new URL("../app/terms/page.tsx", import.meta.url)));
});

test("public homepage is a visitor journey with interactive evidence visuals", () => {
  for (const capability of [
    "Marks tell you who scored. Learning X-Ray tells you why.",
    "Three people. One platform. Three different problems solved.",
    "Illustrative, anonymised Class 9 Science view",
    "From blank paper to proven improvement.",
    "What Learning X-Ray will never do.",
    "Be one of the first ten.",
    "Six weeks from first upload to proven improvement.",
    "Priced per classroom, not per feature.",
    "Straight answers before you pilot.",
  ]) assert.ok(marketing.includes(capability), `missing homepage capability: ${capability}`);
  assert.match(marketing, /type="range"/);
  assert.match(marketing, /setPersona/);
  assert.match(marketing, /href="\/signin"/);
  assert.doesNotMatch(marketing, /\[[A-Z][^\]]+\]/);
});

test("teacher authority and anti-ranking safeguards remain explicit", () => {
  for (const safeguard of ["AI suggestions remain drafts", "No teacher or student leaderboard", "teacher approval", "Insufficient evidence"]) assert.ok(app.toLowerCase().includes(safeguard.toLowerCase()), `missing safeguard: ${safeguard}`);
});

test("learning-gap worksheet cycle is complete and downloadable", () => {
  for (const capability of ["Select an answer sheet to begin", "Visual learning-gap report", "Targeted study guide", "Guided recovery", "Multiple-choice questions", "Subjective questions", "Grade answer worksheets", "Download graded results", "Check with answer key", "Teacher approves grades"]) {
    assert.ok(app.includes(capability), `missing worksheet-cycle capability: ${capability}`);
  }
  assert.match(app, /function downloadWorksheet/);
  assert.match(app, /function downloadAnswerKey/);
  assert.match(app, /WorksheetGradingDialog/);
});

test("grading stays bound to the selected uploaded assessment", () => {
  for (const capability of ["assessment.subject", "questionPaperFileId", "answerKey:assessment.answerKey", "Graded answer sheet:", "Grade answer sheet"]) {
    assert.ok(app.includes(capability), `missing selected-assessment grading behavior: ${capability}`);
  }
  assert.match(app, /openAssessment\(selected\.id,"Review"\)/);
  assert.match(app, /a\.files\.find/);
});

test("teacher explicitly chooses grading or learning-gap analysis", () => {
  for (const capability of ["Grade answer sheet", "View learning gaps", "Select answer sheet for analysis", "Continue with this answer sheet", "Question paper", "Answer sheet", "gradedFileIds"]) {
    assert.ok(app.includes(capability), `missing explicit grading choice: ${capability}`);
  }
  assert.match(app, /assessmentHasGrades/);
  assert.match(app, /type="radio"/);
});

test("class assessment analysis is hierarchical and reports are downloadable", () => {
  for (const capability of [
    "Class & section → Subject → Assessment → Students",
    "Every analysis is linked to a saved assessment",
    "Download Learning Gap Report",
    "Executive summary",
    "Learning gaps requiring attention",
    "every identified learning-gap topic is covered",
  ]) assert.ok(app.includes(capability), `missing hierarchical analysis capability: ${capability}`);
  assert.match(app, /function downloadStudentLearningGapReport/);
  assert.match(app, /function downloadClassLearningGapReport/);
  assert.doesNotMatch(app, />[^<]*Assignment[^<]*</);
});

test("multi-file evidence is appended safely and analysis mapping is explicitly selected", () => {
  assert.match(app, /crypto\.randomUUID\(\)/);
  assert.match(app, /setFiles\(current=>\[\.\.\.current,\.\.\.next\]\)/);
  assert.match(app, /Promise\.allSettled\(Array\.from\(pendingUploads\.current\.values\(\)\)\)/);
  assert.match(app, /Field label="Class & section"><select value=\{analysisClassKey\}/);
  assert.match(app, /Field label="Subject"><select value=\{analysisSubject\}/);
  assert.match(app, /grade:selectedMapping\?\.grade/);
  assert.match(app, /section:selectedMapping\?\.section/);
});

test("multi-student analysis resumes when background generation starts", () => {
  assert.match(app, /saveBulkAnalysisQueue\(assessment\.id,pending\.map/);
  assert.match(app, /advanceBulkAnalysisQueue\(assessment\.id,file\.id\)/);
  assert.match(app, /open\(nextFileId\?/);
});

test("teacher can generate all reports while the next student's OCR starts", () => {
  assert.match(app, /Generate All Reports/);
  assert.match(app, /generateAllStudentResources/);
  assert.match(app, /Reports are generating in the background/);
  assert.match(app, /bulkAnalysisQueue\(assessment\.id\)\.includes\(file\.id\)/);
  assert.match(app, /open\(nextFileId\?/);
});

test("multi-student grading remounts OCR state for each answer sheet", () => {
  assert.match(app, /<PerFileGradeDialog key=\{id\}/);
  assert.match(app, /advanceBulkAnalysisQueue\(assessment\.id,file\.id\)/);
});

test("learning gap view restores the executive summary", () => {
  assert.match(app, /Student performance and priority learning gaps/);
  assert.match(app, /Overall performance/);
  assert.match(app, /Learning-gap summary/);
});

test("reports name the former heatmap Performance matrix report", () => {
  assert.match(app, /Performance matrix report/);
  assert.doesNotMatch(app, /<option>Class heatmap<\/option>/);
});

test("principal dashboard provides four-band class and subject drill-down", () => {
  for (const label of ["90% and above", "75–89%", "55–74%", "Below 55%", "Performance matrix report", "Class drill-down"]) assert.ok(app.includes(label));
  assert.match(app, /percentage>=90\?"green":percentage>=75\?"yellow":percentage>=55\?"orange":"red"/);
  assert.match(app, /setSelectedCell/);
});

test("performance matrix report uses majority bands and student drill-down", () => {
  for (const threshold of ["percentage>=90", "percentage>=75", "percentage>=55"]) assert.ok(app.includes(threshold));
  assert.match(app, /majority \$\{data\.band\}/);
  assert.match(app, /SchoolPerformanceMatrix/);
  assert.match(app, /Class drill-down/);
});

test("QR sharing copies with a compatible fallback and status", () => {
  assert.match(parentShare, /navigator\.clipboard\?\.writeText/);
  assert.match(parentShare, /document\.execCommand\("copy"\)/);
  assert.match(parentShare, /Press Ctrl\+C to copy the selected link/);
});

test("resources expose student-specific signed parent QR sharing", () => {
  assert.match(app, /parent-share:/);
  assert.match(app, /Share with parent/);
  assert.match(app, /ParentShareDialog/);
});

test("active class master data and visible terminology use Class consistently", () => {
  for (const visibleClassText of ["Class 6A · Mathematics", "All classes", 'Field label="Class"', "Class 6 performance trend"]) {
    assert.ok(app.includes(visibleClassText), `missing class terminology: ${visibleClassText}`);
  }
  for (const legacyVisibleText of ["Class/Grade", "Grade 6 · Mathematics", "All grades", 'Field label="Grade"']) {
    assert.ok(!app.includes(legacyVisibleText), `legacy grade terminology remains visible: ${legacyVisibleText}`);
  }
  const worksheetRoute = readFileSync(new URL("../app/api/generate-worksheet/route.ts", import.meta.url), "utf8");
  assert.match(worksheetRoute, /Class: \$\{grade\}/);
  assert.doesNotMatch(worksheetRoute, /Class\/Grade/);
});

test("student learning-gap report uses paired executive-summary tables", () => {
  assert.match(app, /grid-template-columns:minmax\(0,1fr\) minmax\(0,1\.2fr\)/);
  assert.match(app, /Student & assessment details/);
  assert.match(app, /Learning-gap summary/);
  for (const heading of ["Student Name", "Class", "Subject", "Assessment", "Answer Sheet", "Total Marks", "Marks Obtained", "Percentage", "Overall Performance", "Gap", "Mastery", "Status"]) {
    assert.ok(app.includes(heading), `missing report summary field: ${heading}`);
  }
});

test("resource library filters student documents into four downloadable columns", () => {
  for (const filter of ["Filter resources by class", "Filter resources by subject", "Filter resources by assessment"]) {
    assert.ok(app.includes(filter), `missing resource filter: ${filter}`);
  }
  for (const column of ["Student name", "Learning gap report", "Study guide", "Worksheet & answer key"]) {
    assert.ok(app.includes(`role="columnheader">${column}`), `missing resource column: ${column}`);
  }
  assert.match(app, /downloadStudentLearningGapReport\(assessment,result\)/);
  assert.match(app, /downloadStudyGuide\(guide,guide\.guide\)/);
  assert.match(app, /downloadWorksheet\(worksheet,worksheet\.content\)/);
  assert.match(app, /downloadAnswerKey\(worksheet,worksheet\.content\)/);
  assert.match(app, /assessmentId:assessment\.id/);
  assert.match(app, /studentName:worksheet\?\.studentName\|\|presetStudent/);
});

test("all generated downloads use branded PDF documents with reusable visuals", () => {
  for (const capability of [
    'import { jsPDF } from "jspdf"',
    'pdf.output("blob")',
    '}.pdf`',
    'fetch("/brand/logo.png")',
    'class="header-logo"',
    'class="closing-footer"',
    'pdf.addImage(logo',
    'Page ${page} of ${pages}',
    "documentFlowVisual()",
    "masteryVisual(",
  ]) {
    assert.ok(app.includes(capability), `missing branded PDF export capability: ${capability}`);
  }
  assert.doesNotMatch(app, /application\/msword/);
  assert.doesNotMatch(app, /a\.download=.*\.doc`/);
  assert.doesNotMatch(app, /type:"text\/plain;charset=utf-8"/);
  assert.doesNotMatch(app, /Resource_Generation_Status\.pdf/);
  assert.match(app, /All four reports must finish generating before download/);
  assert.match(app, /studentLearningGapDocumentBody\(assessment,result\)/);
  assert.match(app, /studyGuideDocumentBody\(guide\.guide,guide\.evidenceFiles/);
  assert.doesNotMatch(app, /Missing_Files\.txt/);
  assert.match(app, /worksheetDocumentBody\(worksheet\.content\),false/);
  assert.match(app, /answerKeyDocumentBody\(worksheet\.content\),false/);
  assert.match(app, /studyGuideDocumentBody\(guide\.guide,guide\.evidenceFiles/);
  assert.match(app, /String\.fromCharCode\(\.\.\.bytes\.slice\(0,5\)\)!=="%PDF-"/);
});

test("heatmap uses weak, average and excellent score bands", () => {
  assert.match(app, /v>=80\?"excellent":v<=35\?"weak":"average"/);
  for (const label of ["Weak · 35% or less", "Average · 36% to 79%", "Excellent · 80% or above"]) {
    assert.ok(app.includes(label), `missing heatmap category: ${label}`);
  }
  assert.match(app, /aria-label="Heatmap performance categories"/);
});

test("reanalysis, OCR and saved resources preserve teacher workflow", () => {
  for (const capability of ["Reason for Reanalysis", "safe to switch tabs", "Marks Obtained", "Overall Performance", "normalizeOcrText", "Worksheet & answer key", "Download study guide"]) {
    assert.ok(app.includes(capability), `missing resilient analysis capability: ${capability}`);
  }
  const gradeRoute = readFileSync(new URL("../app/api/grade/route.ts", import.meta.url), "utf8");
  assert.match(gradeRoute, /reanalysisReason/);
  assert.match(gradeRoute, /explicitly reconsider that feedback/);
});

test("teacher authentication and first-login onboarding are complete", () => {
  for (const capability of ["signInWithPassword", "signUp", "signInWithOAuth", '"google"', '"azure"', "Complete your teacher profile", "School name", "Log out"]) {
    assert.ok(app.includes(capability), `missing teacher authentication behavior: ${capability}`);
  }
  assert.match(app, /auth\.signOut/);
  assert.match(app, /authFetch\("\/api\/profile"/);
  assert.match(app, /assessments:\[\]/);
});

test("legacy Supabase schemas do not crash authentication or credit display", () => {
  const authorization = readFileSync(new URL("../lib/authorization.ts", import.meta.url), "utf8");
  const credits = readFileSync(new URL("../app/api/credits/route.ts", import.meta.url), "utf8");
  assert.match(authorization, /legacyCreditSchema/);
  assert.match(authorization, /total_credits:0,used_credits:0/);
  assert.match(credits, /creditLedgerAvailable:!migrationPending/);
  assert.match(credits, /PGRST205/);
});

test("analysis derives totals from the compulsory question paper and uses both reference answers", () => {
  const grade = readFileSync(new URL("../app/api/grade/route.ts", import.meta.url), "utf8");
  assert.match(grade, /Determine maxMarks dynamically/);
  assert.match(grade, /PRIMARY REFERENCE/);
  assert.match(app, /questionPaperText/);
  assert.match(app, /markingSchemeText/);
  assert.match(app, /modelAnswerText/);
  assert.match(grade, /validated question paper is compulsory/);
  assert.match(app, /detectedMaxMarks/);
});

test("analysis uses assessment-level question paper, marking scheme and model answer", () => {
  assert.match(app, /otherQuestionPaperChoices=candidates\.filter/);
  assert.match(app, /markingSchemes=candidates\.filter/);
  assert.match(app, /modelAnswers=candidates\.filter/);
  assert.match(app, /A question paper is compulsory/);
  assert.match(app, /changeQuestionPaper/);
  assert.match(app, /markingSchemeId/);
  assert.match(app, /modelAnswerId/);
  assert.match(app, /setOcrDocuments\(null\)/);
  assert.match(app, /selected question paper could not be loaded/);
  assert.match(app, /assessment marking scheme could not be loaded/);
  assert.match(app, /assessment model answer could not be loaded/);
});

test("student uploads preserve assessment reference roles", () => {
  assert.match(app, /const roles:DocumentRole\[\]=\["Question paper","Marking scheme","Model answer","Ungraded answer sheet","Teacher-graded answer sheet","Supporting reference"\]/);
});

test("teacher-graded evidence and exported reports retain teacher authority", () => {
  const grade = readFileSync(new URL("../app/api/grade/route.ts", import.meta.url), "utf8");
  assert.match(app, /documentRole:file\.documentRole\|\|inferDocumentRole/);
  assert.match(grade, /teacher-awarded total/);
  assert.match(app, /Teacher review required/);
  assert.doesNotMatch(app, /Teacher-approved work/);
  assert.match(app, /import html2canvas from "html2canvas"/);
  assert.match(app, /context\.drawImage\(canvas/);
});

test("assessment creation owns reference evidence and branded outputs", () => {
  for (const capability of ["Assessment-first evidence", "Question paper · required", "Marking scheme", "Model answer", "Ungraded answer sheet", "Teacher-graded answer sheet", "scanned handwriting", "Evidence used", "Built from", "Personalised study guide", "Targeted practice worksheet", "EduAI Hub"]) {
    assert.ok(app.includes(capability), `missing evidence-first capability: ${capability}`);
  }
  assert.match(app, /documentRole/);
  assert.match(app, /evidenceSummary/);
  assert.match(app, /BrandDocumentHeader/);
});

test("assessment creation supports AI generation with an optional blueprint", () => {
  for (const capability of ["Upload question paper", "Generate assessment", "Assessment blueprint · optional", "Generate & save assessment", 'authFetch("/api/generate-assessment"']) {
    assert.ok(app.includes(capability), `missing assessment-generation capability: ${capability}`);
  }
  assert.match(app, /createBrandedPdfBlob\(`\$\{title\} · Question Paper`/);
  assert.match(app, /new File\(\[questionPaperPdf\].*Question-Paper\.pdf/);
  assert.match(app, /new File\(\[markingSchemePdf\].*Marking-Scheme\.pdf/);
  assert.match(app, /new File\(\[modelAnswerPdf\].*Model-Answer\.pdf/);
  assert.match(app, /role:"Question paper"/);
  assert.match(app, /role:"Marking scheme"/);
  assert.match(app, /role:"Model answer"/);
  const route = readFileSync(new URL("../app/api/generate-assessment/route.ts", import.meta.url), "utf8");
  assert.match(route, /extractDocumentText\(body\.blueprint/);
  assert.match(route, /questionPaperText/);
  assert.match(route, /markingSchemeText/);
  assert.match(route, /modelAnswerText/);
});

test("document extraction reads text, Word, OpenDocument and spreadsheet uploads", () => {
  const extraction = readFileSync(new URL("../lib/document-text.ts", import.meta.url), "utf8");
  for (const capability of ["text/","docx","odt","word/document.xml","content.xml","xlsx","xls","rtfToText"]) {
    assert.ok(extraction.includes(capability), `missing document extraction support: ${capability}`);
  }
  const ocr = readFileSync(new URL("../app/api/ocr/route.ts", import.meta.url), "utf8");
  assert.match(ocr, /extractDocumentText\(document, apiKey\)/);
  assert.match(app, /accept=\{DOCUMENT_ACCEPT\}/);
});

test("class is the canonical 1 to 12 master in the database and assessment form", () => {
  const workspace = readFileSync(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/20260729000000_class_master_and_assessment_references.sql", import.meta.url), "utf8");
  assert.match(app, /Array\.from\(\{length:12\}/);
  assert.match(app, /Field label="Class"/);
  assert.match(workspace, /className: className \?\? grade/);
  assert.match(migration, /rename column grade to class_name/);
  assert.match(migration, /classes_class_name_check/);
  assert.match(migration, /question_paper_file_id/);
  assert.match(migration, /marking_scheme_file_id/);
  assert.match(migration, /model_answer_file_id/);
});

test("Mistral OCR evidence drives OpenAI learning resources", () => {
  const grade = readFileSync(new URL("../app/api/grade/route.ts", import.meta.url), "utf8");
  const ocr = readFileSync(new URL("../app/api/ocr/route.ts", import.meta.url), "utf8");
  const extraction = readFileSync(new URL("../lib/document-text.ts", import.meta.url), "utf8");
  const worksheet = readFileSync(new URL("../app/api/generate-worksheet/route.ts", import.meta.url), "utf8");
  const studyGuide = readFileSync(new URL("../app/api/generate-study-guide/route.ts", import.meta.url), "utf8");
  assert.match(ocr, /extractDocumentText/);
  assert.match(extraction, /mistral-ocr-latest/);
  assert.match(grade, /gpt-5\.6-sol/);
  assert.match(worksheet, /Subject: \$\{subject\}/);
  assert.match(studyGuide, /Answer-sheet OCR evidence/);
  assert.match(studyGuide, /Do not introduce mathematics examples/);
  assert.match(app, /authFetch\("\/api\/generate-study-guide"/);
});

test("OCR must be teacher-validated before CBSE gap analysis", () => {
  const grade = readFileSync(new URL("../app/api/grade/route.ts", import.meta.url), "utf8");
  const ocr = readFileSync(new URL("../app/api/ocr/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(ocr, /api\.openai\.com/);
  assert.doesNotMatch(grade, /api\.mistral\.ai/);
  for (const behavior of ["Check the extracted text", "Teacher validation required", "Generate All Reports", 'authFetch("/api/ocr"', 'authFetch("/api/grade"']) assert.ok(app.includes(behavior), `missing OCR validation behavior: ${behavior}`);
  assert.match(grade, /Focus ONLY on questions that are completely wrong, partially correct, unanswered, incomplete/);
  assert.match(grade, /Do not create learning gaps from fully correct answers/);
  assert.match(grade, /observed error -> immediate gap -> misconception\/skill weakness -> prerequisite gap -> learning consequence/);
});

test("reanalysis is stable and every diagnosed gap becomes a study-guide topic", () => {
  const grade = readFileSync(new URL("../app/api/grade/route.ts", import.meta.url), "utf8");
  const studyGuide = readFileSync(new URL("../app/api/generate-study-guide/route.ts", import.meta.url), "utf8");
  for (const behavior of ["evidenceFingerprint", "fixed score and learning gaps", "Diagnostic finding", "Likely misunderstanding", "Evidence from the answer", "What the child needs to rework", "guide-topic-index", "guide-topic-sections"]) {
    assert.ok(app.includes(behavior), `missing stable diagnostic behavior: ${behavior}`);
  }
  for (const field of ["misconception", "evidence", "rework"]) assert.ok(grade.includes(field), `missing diagnostic field: ${field}`);
  assert.match(studyGuide, /one topic section for EVERY listed gap/);
  assert.match(studyGuide, /topics: \{/);
});
