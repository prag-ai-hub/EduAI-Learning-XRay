export type HpcStageCode = "foundational" | "preparatory" | "middle" | "secondary";

export type HpcStage = {
  code: HpcStageCode;
  label: string;
  gradeFrom: number;
  gradeTo: number;
};

export const HPC_STAGES: readonly HpcStage[] = [
  { code: "foundational", label: "Foundational", gradeFrom: 0, gradeTo: 2 },
  { code: "preparatory", label: "Preparatory", gradeFrom: 3, gradeTo: 5 },
  { code: "middle", label: "Middle", gradeFrom: 6, gradeTo: 8 },
  { code: "secondary", label: "Secondary", gradeFrom: 9, gradeTo: 12 },
] as const;

export function resolveHpcStage(grade: number | string | null | undefined): HpcStage | null {
  const normalized = typeof grade === "number" ? grade : Number(String(grade ?? "").match(/\d+/)?.[0]);
  if (!Number.isInteger(normalized)) return null;
  return HPC_STAGES.find((stage) => normalized >= stage.gradeFrom && normalized <= stage.gradeTo) ?? null;
}

export function hpcFeatureIsEnabled(settings: { enabled?: boolean } | null | undefined) {
  return settings?.enabled === true;
}
