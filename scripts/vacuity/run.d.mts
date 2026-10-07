/** Types for scripts/vacuity/run.mjs, imported by src/test/vacuityE2eIsLocked.test.ts. */
import type { Mutation } from "./lib.mjs";

export function isPlaywrightGuard(rel: string): boolean;
export function kindOf(m: { guard: string }): "e2e" | "unit";
export function selectKind<T extends { guard: string }>(mutations: T[], kind: "e2e" | "unit" | "all"): T[];
export const E2E_LEGS: number;
export function shardOf<T extends { guard: string }>(mutations: T[], n: number): Map<string, number>;
export function selectShard<T extends { guard: string }>(mutations: T[], k: number, n: number): T[];
export function scopeMutations<T extends { guard: string; target: string }>(
  mutations: T[],
  opts?: { all?: boolean; only?: string[] | null; report?: boolean; changed?: Set<string> | null },
): { scoped: T[]; errors: string[] };
export function collectMutations(guards?: string[]): { mutations: Mutation[]; errors: string[]; exemptions: unknown[] };
