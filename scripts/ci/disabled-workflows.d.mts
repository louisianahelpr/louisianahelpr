export const INTENTIONALLY_OFF: Record<string, string>;
export function judgeWorkflows(
  workflows: { path?: string; state: string }[],
  readFile: (file: string) => string | null,
  allow?: Record<string, string>,
): { rows: string[]; count: number };
