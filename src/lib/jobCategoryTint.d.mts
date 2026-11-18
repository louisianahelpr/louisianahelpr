/** Types for src/lib/jobCategoryTint.mjs (JobCardMedia and the pre-boot Browse shell). */
export type JobCategoryTintName = "sage" | "sky" | "amber" | "rose" | "violet" | "teal" | "stone";
export const JOB_CATEGORY_TINT_NAMES: readonly JobCategoryTintName[];
export const JOB_CATEGORY_TINT: Readonly<Record<string, JobCategoryTintName>>;
export function jobCategoryTintName(category: string): JobCategoryTintName;
export function jobCategoryTint(category: string): { background: string; color: string };
