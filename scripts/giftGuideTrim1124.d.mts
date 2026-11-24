/** [trim ID, guide, link on the page, name]. */
export type TrimRow1124 = readonly [string, string, string, string];
export const TRIM_1124_ROWS: readonly TrimRow1124[];
export function trim1124<T extends { href: string }>(guide: string, rows: readonly T[]): T[];
