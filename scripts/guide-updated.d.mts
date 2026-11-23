/** Types for scripts/guide-updated.mjs (the guide pages' Q&A "Updated" day). */
export type UpdatedTable = Record<string, { day: string; hash: string }>;
export function pageInputs(): Record<string, string>;
export function fingerprint(text: string): string;
export function nextUpdated(previous: UpdatedTable, inputs: Record<string, string>, today: string): UpdatedTable;
export function parseUpdated(text: string): UpdatedTable;
export function moduleText(table: UpdatedTable): string;
