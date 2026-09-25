/** Types for ./request-budget.mjs (plain JS so `node` runs it in CI). */
import type { RequestSample } from "../../e2e/requestMeter.mjs";

export interface RunAggregate {
  label: string;
  total: number;
  byClass: Record<string, number>;
  signIns: number;
  duplicates: number;
  tests: number;
  minutes: Record<string, number>;
  topDuplicates: Record<string, number>;
  samples: number;
  /** Total ms the meter held navigations to stay under the ceiling. */
  paceWaitMs: number;
  peakPerMinute: number;
  perTest: number;
}
export interface Budget {
  ceilingPerMinute?: number;
  perTest?: number | null;
  signIns?: number | null;
}
export declare const STALE_FRACTION: number;
export declare function aggregate(samples: RequestSample[]): Record<string, RunAggregate>;
export declare function budgetFor(budgets: Record<string, Budget>, label: string): Budget;
export declare function judge(agg: RunAggregate, budget: Budget): { failures: string[]; notes: string[] };
export declare function table(aggs: RunAggregate[]): string;
export declare function shapeKey(key: string): string;
export declare function topShapes(topDuplicates: Record<string, number>, n?: number): [string, number][];
