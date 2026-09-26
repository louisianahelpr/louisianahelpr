/**
 * Types for ./settleForward.mjs.
 *
 * Hand-written rather than generated because the implementation is plain JS on
 * purpose: prod-lifecycle-sweeper.mjs and the ops runner beside it are run by
 * `node` in CI (node 22, no type stripping), while e2e/journeys/02-marketplace.spec.ts
 * imports the same module through Playwright's TypeScript pipeline. One
 * implementation, two loaders, and this file is what lets the second one see it.
 */

export declare const SETTLEABLE_STATUSES: string[];
export declare const SETTLED_PAYMENT_STATUSES: string[];

/** Title token a lane puts on a marker job it holds past one run. */
export declare const E2E_HOLD_MARKER: string;
/** settleRefusalReason's answer for a funded row with no Checkout Session. */
export declare const NO_CHECKOUT_SESSION: string;
/** Why a row is held (title marker, or the PLAYWRIGHT_LIFECYCLE_JOB_ID fixture), or null. */
export declare function heldReason(
  job: { id?: string; title?: unknown },
  env?: Record<string, string | undefined>,
): string | null;

/** True when a `cancel_escrow` answer is the 409 that means "hired and funded". */
export declare function isSettleForwardRefusal(status: number, body?: string): boolean;

export interface SettleSeats {
  posterId: string;
  helperId: string;
}

export interface SettleForwardInput extends SettleSeats {
  base: string;
  anon: string;
  posterToken: string;
  helperToken: string;
  jobId: string;
  log?: (line: string) => void;
}

export interface SettleForwardResult {
  settled: boolean;
  reason: string;
  steps: string[];
  paymentStatus: string | null;
  status: string | null;
}

export declare function readJobRow(input: {
  base: string;
  anon: string;
  posterToken: string;
  jobId: string;
}): Promise<Record<string, unknown>>;

/** Why this row must NOT be settled forward, or null when it may be. */
export declare function settleRefusalReason(
  job: Record<string, unknown> | null | undefined,
  seats: SettleSeats,
): string | null;

export declare function settleJobForward(input: SettleForwardInput): Promise<SettleForwardResult>;
