export type HpcAbility = "awareness" | "sensitivity" | "creativity";
export type HpcPerspective = "self" | "peer" | "teacher";
export type HpcPerformanceLevel = "beginner" | "proficient" | "advanced";

export const PARAKH_MIDDLE_STAGE_SCORING_VERSION = "PARAKH_HPC_MIDDLE_STAGE_2023_SCORING_KEY";

/** Official Middle Stage rule: six statements per ability, kept per perspective. */
export function classifyParakhMiddleStageCount(count: number): HpcPerformanceLevel {
  if (!Number.isInteger(count) || count < 0 || count > 6) throw new Error("An official HPC ability count must be an integer from 0 to 6.");
  if (count <= 2) return "beginner";
  if (count <= 4) return "proficient";
  return "advanced";
}

export type PerspectiveScores = Partial<Record<HpcPerspective, number>>;
export type AbilityProgress = { ability: HpcAbility; perspectives: Partial<Record<HpcPerspective, { count: number; level: HpcPerformanceLevel }>> };

/** Deliberately returns perspectives separately; there is no blended or averaged HPC score. */
export function buildMiddleStageAbilityProgress(ability: HpcAbility, scores: PerspectiveScores): AbilityProgress {
  const perspectives: AbilityProgress["perspectives"] = {};
  for (const perspective of ["self", "peer", "teacher"] as const) {
    const count = scores[perspective];
    if (count !== undefined) perspectives[perspective] = { count, level: classifyParakhMiddleStageCount(count) };
  }
  return { ability, perspectives };
}
