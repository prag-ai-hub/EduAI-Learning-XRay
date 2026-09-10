/**
 * The body of each exported document, as an HTML string.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx:1875-1920. Each function
 * returns only the middle of the page - the cover, the evidence/insight/action
 * banner and the footer are added by `brandedDocumentHtml` - so the same body
 * can be rasterised into a PDF, embedded in an email or diffed in a test.
 *
 * Everything user-supplied goes through `htmlEscape`. Mastery percentages are
 * interpolated raw because they are numbers by the time they arrive; the layout
 * is `<table>` rather than flexbox for the reason `html.ts` records - it is the
 * one construct html2canvas and a print WebView lay out identically.
 *
 * No platform module is imported and no DOM is touched: these build strings.
 */

import {
  htmlEscape,
  learningGapExecutiveSummary,
  masteryVisual,
} from '@/features/documents/lib/html';
import type {
  Assessment,
  GradeResult,
  StudyGuide,
  UploadFile,
  WorksheetContent,
} from '@/shared/types/workspace';

/**
 * The printable worksheet: a details block a student fills in by hand, then the
 * questions. Multiple choice comes first and written responses continue its
 * numbering, which is the same order `worksheetMarkingSchemeText` uses.
 */
export function worksheetDocumentBody(content?: WorksheetContent): string {
  const questions = [
    ...(content?.mcqQuestions || []).map(
      (q, i) =>
        `<li><span class="label">${htmlEscape(q.concept || 'Topic')}</span><b>${i + 1}. ${htmlEscape(
          q.question,
        )}</b><div class="options">${q.options
          .map((o: string, j: number) => `${String.fromCharCode(65 + j)}. ${htmlEscape(o)}`)
          .join('<br>')}</div></li>`,
    ),
    ...(content?.subjectiveQuestions || []).map(
      (q, i) =>
        `<li><span class="label">${htmlEscape(q.concept || 'Topic')}</span><b>${
          (content?.mcqQuestions.length || 0) + i + 1
        }. ${htmlEscape(q.question)}</b><p>Answer:</p><br><br></li>`,
    ),
  ].join('');
  return `<h2>Student details</h2><p>Name: ____________________ &nbsp;&nbsp; Date: __________ &nbsp;&nbsp; Teacher: ____________________</p><h2>Instructions</h2><p>Answer every question. Show working or supporting evidence where required.</p><ol>${questions}</ol>`;
}

/**
 * The teacher's copy of the same worksheet.
 *
 * The parameter is structural rather than `WorksheetContent` because the answer
 * key needs only three fields per question, and the dialogs that build an
 * unsaved preview pass a literal that has exactly those.
 */
export function answerKeyDocumentBody(content?: {
  mcqQuestions: { question: string; options: string[]; correctIndex: number; concept?: string }[];
  subjectiveQuestions: { question: string; modelAnswer: string; concept?: string }[];
}): string {
  const mcqKey = (content?.mcqQuestions || [])
    .map(
      (q, i) =>
        `<div class="answer"><span class="label">${htmlEscape(
          q.concept || 'Topic',
        )}</span><b>${i + 1}. ${String.fromCharCode(65 + q.correctIndex)}</b> — ${htmlEscape(
          q.options[q.correctIndex],
        )}</div>`,
    )
    .join('');
  const subjKey = (content?.subjectiveQuestions || [])
    .map(
      (q, i) =>
        `<div class="answer"><span class="label">${htmlEscape(q.concept || 'Topic')}</span><b>${
          (content?.mcqQuestions.length || 0) + i + 1
        }. Model answer</b><p>${htmlEscape(q.modelAnswer)}</p></div>`,
    )
    .join('');
  return `<h2>Multiple-choice answers</h2>${
    mcqKey || '<p>None</p>'
  }<h2>Written-response marking guide</h2>${subjKey || '<p>None</p>'}`;
}

/**
 * The study guide: an overview, a topic plan table, the evidence it was built
 * from, then one `.topic` section per learning gap.
 *
 * Each section is `page-break-inside: avoid` in the print stylesheet, so a
 * topic is never sliced across two pages.
 */
export function studyGuideDocumentBody(
  guide: StudyGuide | undefined,
  evidenceFiles: string[] = [],
): string {
  const topicPlan = (guide?.topics || [])
    .map(
      (t, i) =>
        `<tr><td>${i + 1}</td><td>${htmlEscape(t.concept)}</td><td>${htmlEscape(t.mastery)}%</td></tr>`,
    )
    .join('');
  const sources = evidenceFiles.map((file) => `<li>${htmlEscape(file)}</li>`).join('');
  const topics = (guide?.topics || [])
    .map(
      (t, i) =>
        `<section class="topic"><span class="label">Topic ${i + 1}</span><span class="label">${htmlEscape(
          t.mastery,
        )}% starting mastery</span><h2>${htmlEscape(
          t.concept,
        )}</h2><h3>Why this is a learning gap</h3><p>${htmlEscape(
          t.diagnosis,
        )}</p><h3>Learning objective</h3><p>${htmlEscape(
          t.learningObjective,
        )}</p><h3>Clear explanation</h3><p>${htmlEscape(
          t.explanation,
        )}</p><h3>Worked example</h3><div class="answer">${htmlEscape(
          t.workedExample,
        )}</div><h3>Guided practice</h3><ol>${(t.practiceSteps || [])
          .map((x: string) => `<li>${htmlEscape(x)}</li>`)
          .join('')}</ol><h3>Check for understanding</h3><ol>${(t.checkForUnderstanding || [])
          .map((x: string) => `<li>${htmlEscape(x)}</li>`)
          .join('')}</ol></section>`,
    )
    .join('');
  return `<h2>Overview</h2><p>${htmlEscape(
    guide?.overview || '',
  )}</p><h2>Topic plan</h2><table><thead><tr><th>#</th><th>Learning-gap topic</th><th>Starting mastery</th></tr></thead><tbody>${topicPlan}</tbody></table>${
    sources ? `<h2>Built from</h2><ul>${sources}</ul>` : ''
  }${topics}`;
}

/**
 * One student's learning-gap report: a two-panel executive summary, then a
 * `.topic` card per gap, weakest first.
 *
 * The status colours are inlined per row rather than classed because the panel
 * is the block most likely to be pasted into a mail client that drops the
 * stylesheet. They repeat the thresholds `masteryTone` owns - kept as literals
 * here so the exported document does not depend on the app's palette.
 */
export function studentLearningGapDocumentBody(
  assessment: Assessment,
  result: GradeResult,
  file?: UploadFile,
): string {
  const details = result.gaps
    .slice()
    .sort((a, b) => a.mastery - b.mastery)
    .map(
      (g, index) =>
        `<section class="topic"><span class="label">Gap ${index + 1}</span><span class="label">${
          g.mastery
        }% mastery</span><h2>${htmlEscape(g.concept)}</h2>${masteryVisual(
          g.concept,
          g.mastery,
        )}<h3>Diagnostic finding</h3><p>${htmlEscape(
          g.finding || 'Incomplete understanding identified.',
        )}</p><h3>Likely misunderstanding</h3><p>${htmlEscape(
          g.misconception || 'Review the validated report for the likely misconception.',
        )}</p><h3>Finding from the answer</h3><p>${htmlEscape(
          g.evidence || result.feedback || 'Teacher-reviewed answer finding.',
        )}</p><h3>Required rework</h3><p>${htmlEscape(
          g.rework || `Revisit and practise ${g.concept}.`,
        )}</p></section>`,
    )
    .join('');
  const percentage = Math.round((result.score / Math.max(1, result.maxMarks)) * 100),
    performance =
      percentage >= 90
        ? 'Excellent'
        : percentage >= 75
          ? 'Good'
          : percentage >= 55
            ? 'Developing'
            : 'Priority support required';
  const gapRows = result.gaps
    .slice()
    .sort((a, b) => a.mastery - b.mastery)
    .map((g, index) => {
      const status = g.mastery < 55 ? 'Priority' : g.mastery < 80 ? 'Developing' : 'Secure',
        colour = g.mastery < 55 ? '#9f2d24' : g.mastery < 80 ? '#8a5a00' : '#23672d';
      return `<tr><td>${index + 1}. ${htmlEscape(g.concept)}</td><td><b>${
        g.mastery
      }%</b></td><td style="color:${colour};font-weight:700">${status}</td></tr>`;
    })
    .join('');
  const row = (label: string, value: string | number) => `<tr><th>${label}</th><td>${value}</td></tr>`;
  const summary = `<section class="executive"><h2>Executive summary</h2><div class="executive-panels"><div><h3>Student & assessment details</h3><table><tbody>${row(
    'Student Name',
    htmlEscape(result.studentName),
  )}${row('Class', `Class ${htmlEscape(assessment.grade)}${htmlEscape(assessment.section)}`)}${row(
    'Subject',
    htmlEscape(assessment.subject),
  )}${row('Assessment', htmlEscape(assessment.title))}${row(
    'Answer Sheet',
    htmlEscape(file?.name || 'Uploaded answer sheet'),
  )}${row('Total Marks', result.maxMarks)}${row('Marks Obtained', result.score)}${row(
    'Percentage',
    `${percentage}%`,
  )}${row(
    'Overall Performance',
    `<b>${performance}</b>`,
  )}</tbody></table></div><div><h3>Learning-gap summary</h3><table><thead><tr><th>Gap</th><th>Mastery</th><th>Status</th></tr></thead><tbody>${gapRows}</tbody></table></div></div></section>`;
  return `${summary}${details || '<p>No learning gap was identified.</p>'}`;
}

/**
 * The class report: every concept as a mastery bar, then one row per student
 * naming their weakest concept.
 *
 * Extracted from `downloadClassLearningGapReport`, which built its body inline.
 * The download itself - the title, the meta line and the PDF - belongs to
 * `downloads.ts`; this is only the body so it can be built without a renderer.
 */
export function classLearningGapDocumentBody(results: GradeResult[]): string {
  const totals = new Map<string, { sum: number; count: number }>();
  results.forEach((result) =>
    result.gaps.forEach((g) => {
      const item = totals.get(g.concept) || { sum: 0, count: 0 };
      item.sum += g.mastery;
      item.count++;
      totals.set(g.concept, item);
    }),
  );
  const gaps = Array.from(totals, ([concept, item]) => ({
    concept,
    mastery: Math.round(item.sum / item.count),
  })).sort((a, b) => a.mastery - b.mastery);
  const students = results
    .map(
      (result) =>
        `<tr><td>${htmlEscape(result.studentName)}</td><td>${result.score}/${
          result.maxMarks
        }</td><td>${htmlEscape(
          result.gaps.slice().sort((a, b) => a.mastery - b.mastery)[0]?.concept ||
            'No gap identified',
        )}</td></tr>`,
    )
    .join('');
  return `${learningGapExecutiveSummary(
    gaps,
  )}<h2>Student analysis</h2><table><thead><tr><th>Student</th><th>Score</th><th>Priority learning gap</th></tr></thead><tbody>${students}</tbody></table>`;
}
