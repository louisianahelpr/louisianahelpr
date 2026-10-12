/** Types for scripts/owner-needed.mjs, imported by src/test/ownerNeededInbox.test.ts. */
export const LABEL: string;
export const JARGON: string[];
export function jargonIn(text: string): string[];
export function normalizeQ(q: unknown): string | null;
export function marker(q: string): string;
export function checkQuestion(r: { q?: string; title?: string; options?: string[] }): string | null;
export function buildBody(r: { q: string; options: string[] }): string;
export function findDuplicate(issues: { body?: string }[], q: string): { body?: string } | undefined;
