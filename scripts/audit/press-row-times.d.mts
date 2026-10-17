// Types for the press row-cost generator, so guards in src/test can import it
// under `tsc -b --noEmit`.
export type RowMeasure = { key: string; url: string; persona: string; min: number; work: number; req: number; complete: boolean };
export declare function requestsInSpan(minutes: Record<string, number>, fromMs: number, toMs: number): number;
export declare function rowCostsFromResults(results: unknown[], meterMinutes?: Record<string, number>): RowMeasure[];
export declare function runRowCosts(measures: RowMeasure[]): Map<string, { min: number; work: number; req: number }>;
