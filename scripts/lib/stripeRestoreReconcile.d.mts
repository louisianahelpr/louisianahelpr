export type Kind = "payment_intent" | "transfer" | "refund";
export const DB_ID_COLUMNS: Record<Kind, { table: string; column: string }[]>;
export const NOT_MATCHED: Record<string, string>;
export const CANDIDATE_COLUMN: RegExp;
export const STRIPE_LISTS: Record<Kind, string>;
export const MONEY_PI_STATUSES: Set<string>;
export function unlinkableReason(pi: Record<string, unknown>): string | null;
export function isStripeList(page: unknown): boolean;
export function hint(kind: Kind, obj: Record<string, unknown>): string;
export interface Graded {
  matched: number;
  missing: { id: string; amount: number; created: number; status: string | null; reversed: boolean | null; hint: string }[];
  unlinkable: { id: string; amount: number; created: number; why: string; hint: string }[];
  ignored: number;
}
export function gradeKind(kind: Kind, objects: Record<string, unknown>[], dbIds: Set<string>): Graded;
export function parseSince(value: unknown): number;
export function keyForMode(mode: string, env: Record<string, string | undefined>): string;
