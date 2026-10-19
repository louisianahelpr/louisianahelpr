/**
 * Types for ./requestMeter.mjs (plain JS so `node` can run the scripts that
 * import it; see that file's header).
 */
import type { APIRequestContext, Browser, BrowserContext } from "@playwright/test";

export declare const REQUEST_BUDGET_DIR: string;
export declare const DUPLICATE_WINDOW_MS: number;
export declare const PACE_MIN_RESERVE: number;
export declare const PACE_EDGE_MS: number;
export declare function ceilingFor(label: string, file?: string): number;
export declare function priorMinutes(label: string, dir?: string): Record<string, number>;
export declare const SLOT_RESTART_GRACE_MS: number;
export declare function siblingState(
  label: string,
  opts?: { ownFile?: string | null; ownSlot?: number | null; ppid?: number; dir?: string; now?: number },
): { minutes: Record<string, number>; freeSlots: number };
export declare function priorBursts(label: string, dir?: string): { bursts: Record<string, number>; reserve: number };
export type RequestClass = "rest" | "rpc" | "auth" | "functions" | "storage" | "realtime" | "other";
export declare function classify(url: string): RequestClass | null;
export declare function isSignIn(url: string, method: string): boolean;
export declare function requestKey(method: string, url: string): string;

export interface RequestSample {
  label: string;
  total: number;
  byClass: Partial<Record<RequestClass, number>>;
  signIns: number;
  duplicates: number;
  tests: number;
  minutes: Record<string, number>;
  topDuplicates: Record<string, number>;
  /** Every backend request by endpoint shape; absent in samples written before it existed. */
  byShape?: Record<string, number>;
  /** ms the pacer held navigations; absent in samples written before pacing. */
  paceWaitMs?: number;
  /** largest burst between two gates, per gate key (page path), top 5; absent before #1794. */
  topBursts?: Record<string, number>;
  /** every gate key's largest burst, for the next process of the label (priorBursts); absent before 2026-10-17. */
  learnedBursts?: Record<string, number>;
  /** the learned reserve; absent before 2026-10-17. */
  reserve?: number;
  /** The Playwright runner process the worker belongs to; absent before #2375. */
  ppid?: number;
  /** The worker's parallelIndex in that runner (null outside Playwright); absent before #2375. */
  slot?: number | null;
  /** false once the worker closed its meter; absent before #2375. */
  live?: boolean;
  startedAt: number;
  endedAt: number;
}

export declare class RequestMeter {
  constructor(label: string);
  label: string;
  total: number;
  signIns: number;
  duplicates: number;
  tests: number;
  minutes: Record<string, number>;
  byShape: Record<string, number>;
  ceiling: number;
  ceilingTotal: number;
  prior: Record<string, number>;
  workers: number;
  slot: number | null;
  followSiblings: boolean;
  live: boolean;
  file?: string;
  reserve: number;
  bursts: Record<string, number>;
  paceWaitMs: number;
  onPaceWait: ((ms: number) => void) | null;
  paceTo(
    ceilingPerMinute: number,
    opts?: {
      workers?: number;
      slot?: number | null;
      followSiblings?: boolean;
      siblingsDir?: string;
      prior?: Record<string, number>; learned?: { bursts: Record<string, number>; reserve: number };
      now?: () => number;
      sleep?: (ms: number) => Promise<unknown>;
    },
  ): this;
  pace(key?: string): Promise<number>;
  currentBursts(): Record<string, number>;
  pacePage<P extends { goto: (...a: never[]) => unknown; reload: (...a: never[]) => unknown }>(page: P): P;
  record(url: string, method: string, now?: number, seen?: Map<string, number>): RequestClass | null;
  attach(context: BrowserContext): BrowserContext;
  attachBrowser(browser: Browser): Browser;
  attachApi<T extends APIRequestContext>(api: T): T;
  toJSON(): RequestSample;
  flush(): string;
  close(): string;
}
export declare function pageKey(url: unknown): string;
export declare function gateClientNav(page: unknown, path: string): Promise<number>;
