export const WINDOW_DAYS: number;
export const CLICKS_SQL: string;
export function rankFromClicks(rows: unknown): Record<string, number>;
export function fileBody(ranks: Record<string, number>, day: string): string;
