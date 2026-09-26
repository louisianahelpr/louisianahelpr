/** Types for scripts/vacuity/lib.mjs, imported by src/test/vacuityMutationIsLiteral.test.ts and src/test/mutateTargetsTheNewestDefinition.test.ts. */
export interface Mutation {
  guard: string;
  line: number;
  target: string;
  find: string;
  replace: string;
  raw: string;
  malformed: boolean;
  tooManyFields: boolean;
}
export interface Exemption {
  guard: string;
  line: number;
  reason: string;
}
export const REPO: string;
export function guardFiles(): string[];
export function untrackedGuardFiles(): string[];
export function parseDirectives(rel: string): { mutations: Mutation[]; exemptions: Exemption[] };
export function applyMutation(source: string, find: string, replace: string): string;
