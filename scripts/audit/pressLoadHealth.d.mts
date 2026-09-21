// Types for the press harness's boot-health classifier, so guards in src/test
// can import it under `tsc -b --noEmit` (the .mjs itself is plain Node ESM,
// run by scripts/audit/press-every-control.mjs).
export declare const SELF_HEAL_SEL: string;
export declare const SELF_HEAL_MS: number;

export type Heal = { healing: boolean; healed: boolean; waitedMs: number };
export type BootVerdict = { fail: boolean; why: string; note: string | null };
export type RequestTiming = { ms: number; url: string; method?: string; failed?: boolean };
export type NetSummary = {
  requests: number; apiRequests: number; failed: number;
  medianMs: number; p95Ms: number; maxMs: number;
  apiMedianMs: number; apiP95Ms: number; slowest: string[];
};

/** Minimal surface of a Playwright Page that awaitSelfHeal uses. */
export type HealPage = {
  locator: (sel: string) => { count: () => Promise<number> };
  waitForFunction: (fn: unknown, arg?: unknown, opts?: { timeout?: number }) => Promise<unknown>;
};

export declare function awaitSelfHeal(page: HealPage, opts?: { timeout?: number; sel?: string }): Promise<Heal>;
export declare function classifyBoot(input: { text: string; errorRx: RegExp; heal: Heal }): BootVerdict;
export declare function summarizeTimings(timings: RequestTiming[], opts?: { slowest?: number; apiRx?: RegExp }): NetSummary;
