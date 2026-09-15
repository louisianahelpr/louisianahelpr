export interface VercelMetric {
  name: string;
  match: RegExp;
  limit: number | null;
  unit: string;
  sourceUrl: string;
  note: string;
}
export const TEAM_ID: string;
export const CHARGES_URL: string;
export const SKIP_MESSAGE: string;
export const METRICS: VercelMetric[];

export interface FocusRow {
  ServiceName?: string;
  ConsumedQuantity?: number | string | null;
  ConsumedUnit?: string | null;
  [key: string]: unknown;
}
export interface ParseError {
  line: string;
  error: string;
}
export function parseFocusJsonl(text: string): { rows: FocusRow[]; errors: ParseError[] };
export function matchMetric(serviceName: string | undefined | null, metrics?: VercelMetric[]): VercelMetric | null;

export interface MetricAggregate {
  consumed: number;
  reportedUnits: string[];
}
export interface IgnoredService {
  serviceName: string;
  consumed: number;
}
export function aggregateByMetric(
  rows: FocusRow[],
  metrics?: VercelMetric[],
): { byMetric: Record<string, MetricAggregate>; ignored: IgnoredService[] };

export interface MetricEvaluation {
  name: string;
  consumed: number;
  unit: string;
  reportedUnits: string[];
  limit: number | null;
  pct: number | null;
  critical: boolean;
  sourceUrl: string;
  note: string;
}
export function evaluateMetrics(
  byMetric: Record<string, MetricAggregate>,
  opts?: { thresholdPercent?: number; metrics?: VercelMetric[] },
): MetricEvaluation[];
export function anyCritical(evals: MetricEvaluation[]): boolean;
export function formatSummary(evals: MetricEvaluation[], thresholdPercent: number): string;
export function buildReportMarkdown(args: {
  evals: MetricEvaluation[];
  ignored: IgnoredService[];
  thresholdPercent: number;
  from: string;
  to: string;
  parseErrors?: ParseError[];
}): string;

export type VercelUsageResult =
  | { outcome: "skip"; warn: false; summary: string; message: string }
  | { outcome: "fail"; warn: false; status?: number; error: string }
  | {
      outcome: "ok";
      warn: boolean;
      summary: string;
      report: string;
      evals: MetricEvaluation[];
      ignored: IgnoredService[];
      parseErrors: ParseError[];
    };

export function runVercelUsageCheck(args: {
  token?: string | null;
  teamId?: string;
  from: string;
  to: string;
  thresholdPercent?: number;
  metrics?: VercelMetric[];
}): Promise<VercelUsageResult>;
