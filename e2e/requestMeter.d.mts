/**
 * Types for ./requestMeter.mjs (plain JS so `node` can run the scripts that
 * import it; see that file's header).
 */
import type { Browser, BrowserContext } from "@playwright/test";

export declare const REQUEST_BUDGET_DIR: string;
export declare const DUPLICATE_WINDOW_MS: number;
export declare const PACE_MIN_RESERVE: number;
export declare const PACE_EDGE_MS: number;
export declare function ceilingFor(label: string, file?: string): number;
export declare function priorMinutes(label: string, dir?: string): Record<string, number>;
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
  reserve: number;
  paceWaitMs: number;
  onPaceWait: ((ms: number) => void) | null;
  paceTo(
    ceilingPerMinute: number,
    opts?: { workers?: number; prior?: Record<string, number>; now?: () => number; sleep?: (ms: number) => Promise<unknown> },
  ): this;
  pace(): Promise<number>;
  pacePage<P extends { goto: (...a: never[]) => unknown; reload: (...a: never[]) => unknown }>(page: P): P;
  record(url: string, method: string, now?: number, seen?: Map<string, number>): RequestClass | null;
  attach(context: BrowserContext): BrowserContext;
  attachBrowser(browser: Browser): Browser;
  toJSON(): RequestSample;
  flush(): string;
}
