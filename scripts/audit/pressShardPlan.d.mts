// Types for the press shard planner, so guards in src/test can import it under
// `tsc -b --noEmit`.
export declare const ROW_TIMES_FILE: string;
export declare const PLAN_SHARDS: number;
export declare const PLAN_WAVE_WIDTH: number;
export declare const PLAN_BUDGET_MIN: number;
export declare const PLAN_MARGIN: number;
export declare const PART_CAP_MIN: number;
export declare const PART_OVERHEAD_MIN: number;
export type RowTimes = {
  measuredFrom: { run: string; shardMin: number; paceMin: number; requests: number }[];
  default: { work: number; req: number };
  rows: Record<string, { min: number; work: number; req: number }>;
};
export type PlanRow = { routeIdx: number; url: string; persona: string; redirect: boolean };
export type PlanUnit = PlanRow & { key: string; part: number; parts: number; est: number; req: number; shard?: number };
export type PlanBin = { shard: number; minutes: number; req: number; units: PlanUnit[] };
export type Plan = { units: PlanUnit[]; bins: PlanBin[] };
export type LegModel = { leg: number; shards: number[]; work: number; req: number; paced: number; minutes: number };
export declare function legRatePerMin(ceilingPerMinute: number): number;
export declare function rowTimeKey(url: string, persona: string): string;
export declare function loadRowTimes(file?: string): RowTimes;
export declare function rowCost(times: RowTimes, url: string, persona: string): { work: number; req: number; measured: boolean };
export declare function planShards(o: { rows: PlanRow[]; times: RowTimes; shards?: number; width?: number; partCapMin?: number; ceilingPerMinute?: number }): Plan;
export declare function legMinutes(plan: Plan, o: { ceilingPerMinute: number; width?: number }): LegModel[];
export declare function shardWalkOrder(plan: Plan, shard: number, o: { lastWave: boolean }): PlanUnit[];
export declare function unitFits(o: { estMin: number; elapsedMs: number; budgetMs: number; lastWave: boolean }): boolean;
export declare function inPart(index: number, part: number, parts: number): boolean;
