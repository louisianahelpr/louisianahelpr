export const RED: Set<string>;
export function redPrs(
  prs: { number: number; url?: string; statusCheckRollup?: { name?: string; context?: string; conclusion?: string | null; state?: string | null }[] }[] | null | undefined,
): { number: number; url?: string; red: string[] }[];
export function verdict(prs: Parameters<typeof redPrs>[0]): { red: "true" | "false"; message: string };
