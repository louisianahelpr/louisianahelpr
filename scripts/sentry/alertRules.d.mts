export type Tier = "P0" | "P1" | "P2";
export type MatchType = "co" | "nc" | "eq" | "ne" | "sw" | "ew" | "is" | "ns";
export type RuleFilter =
  | { kind: "event_attribute"; attribute: string; match: MatchType; value: string }
  | { kind: "tagged_event"; key: string; match: MatchType; value: string };
export interface AlertRule {
  doc: string;
  name: string;
  tier: Tier;
  triggers: string[];
  frequency: { value: number; interval: string } | null;
  all: RuleFilter[];
  anyOf: RuleFilter[];
}
export interface WorkflowCondition {
  id?: string;
  type: string;
  comparison: unknown;
  conditionResult?: boolean;
}
export interface WorkflowAction {
  id?: string;
  type: string;
  integrationId?: string | null;
  data?: Record<string, unknown>;
  config?: { targetType?: string; targetDisplay?: string | null; targetIdentifier?: string | null };
  status?: string;
}
export interface WorkflowActionFilter {
  id?: string;
  logicType: string;
  conditions: WorkflowCondition[];
  actions: WorkflowAction[];
}
export interface WorkflowPayload {
  id?: string;
  name: string;
  enabled?: boolean;
  environment?: string | null;
  config?: { frequency?: number };
  detectorIds?: Array<number | string>;
  triggers?: { logicType: string; conditions: WorkflowCondition[] };
  actionFilters?: WorkflowActionFilter[];
  [key: string]: unknown;
}
export interface PlanStep {
  action: "create" | "update" | "skip";
  name: string;
  id?: string;
  payload: WorkflowPayload;
  diffs: string[];
}
export const ENVIRONMENT: string;
export const FREQUENCY_MINUTES: Record<Tier, number>;
export const ALLOWED_FREQUENCIES: number[];
export const FREQUENCY_INTERVALS: string[];
export const MATCH_TYPES: MatchType[];
export const TRIGGER_TYPES: string[];
export const RULES: AlertRule[];
export function filterCondition(f: RuleFilter): WorkflowCondition;
export function frequencyCondition(freq: { value: number; interval: string }): WorkflowCondition;
export function emailAction(): WorkflowAction;
export function actionFilters(rule: AlertRule): WorkflowActionFilter[];
export function buildPayload(rule: AlertRule, opts: { detectorId: number | string }): WorkflowPayload;
export function normalizeWorkflow(w: WorkflowPayload): Record<string, unknown>;
export function diffWorkflow(desired: WorkflowPayload, existing: WorkflowPayload): string[];
export function planRules(desired: WorkflowPayload[], existing: WorkflowPayload[]): PlanStep[];
export function verifyReadback(desired: WorkflowPayload[], after: WorkflowPayload[]): string[];
export function ruleNamesInDoc(markdown: string): string[];
