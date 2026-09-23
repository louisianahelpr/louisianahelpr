export function staleUntracked(files: { path: string; mtimeMs: number }[], nowMs: number, maxAgeDays?: number): string[];
