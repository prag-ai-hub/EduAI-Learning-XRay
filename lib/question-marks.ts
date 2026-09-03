export type QuestionMark = { id: string; maxMarks: number };

// The question paper is the only authority for per-question maxima.  This
// deliberately accepts common OCR forms such as "Q1 (0.5 mark)", "1. 2M"
// and "Q2(a) [1.5 marks]" while preserving decimal values.
export function extractQuestionMarks(questionPaperText: string): QuestionMark[] {
  const marks = new Map<string, number>();
  const pattern = /(?:^|\n|\r)\s*(?:q(?:uestion)?\.?\s*)?(\d+(?:\s*\(?\s*[a-z]\s*\)?)?)\s*(?:[.:)\-]|\s)\s*(?:[^\n]{0,110}?(?:\(|\[|\-|:|,)?\s*)(\d+(?:\.\d+)?)\s*(?:marks?|m)\b/gi;
  for (const match of questionPaperText.matchAll(pattern)) {
    const id = `q${match[1].replace(/[\s().]/g, "").toLowerCase()}`;
    const maxMarks = Number(match[2]);
    if (Number.isFinite(maxMarks) && maxMarks > 0) marks.set(id, maxMarks);
  }
  return [...marks.entries()].map(([id, maxMarks]) => ({ id, maxMarks }));
}

export function questionMarkId(value: string) {
  const normalized = value.toLowerCase().match(/\d+(?:\s*\(?\s*[a-z]\s*\)?)?/);
  return normalized ? `q${normalized[0].replace(/[\s().]/g, "")}` : "";
}
