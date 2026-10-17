export const MAX_BEHIND: number;
export function freshVerdict(s: { behind: number | null; changedOnMain: string[]; ci: boolean; override: string }): { ok: boolean; reason: string };
export function localImportClosure(entry: string, top: string): string[];
export function assertFreshCheckout(
  scriptUrl: string,
  opts?: { also?: string[]; env?: NodeJS.ProcessEnv; entryOnly?: boolean; argv?: string[] },
): void;
