/** The six-statement rule is defined only for Middle Stage grades 6–8. */
export function supportsMiddleAbilityCounts(grade: unknown): boolean {
  return typeof grade === "number" && Number.isInteger(grade) && grade >= 6 && grade <= 8;
}

export function validateMiddleAbilityInput(grade: unknown, input: Record<string, unknown>): string | null {
  if (!supportsMiddleAbilityCounts(grade)) return "Six-statement ability counts apply only to Grades 6–8. Secondary learners use the applied-learning rubric workflow.";
  if (!["self", "peer", "teacher"].includes(String(input.perspective))) return "Choose self, peer, or teacher.";
  if (typeof input.statementCount !== "number" || !Number.isInteger(input.statementCount) || input.statementCount < 0 || input.statementCount > 6) return "An official HPC ability count must be an integer from 0 to 6.";
  const override = input.teacherOverrideLevel;
  if (override && (input.perspective !== "teacher" || !["beginner", "proficient", "advanced"].includes(String(override)))) return "Only a teacher perspective may have a valid teacher override.";
  if (override && !String(input.evidenceNote || "").trim()) return "Record an evidence note explaining the teacher override.";
  return null;
}
