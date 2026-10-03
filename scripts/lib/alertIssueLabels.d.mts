export type AlertSeverity = "critical" | "error" | "warning" | "info";
export const ALERT_ISSUE_LABELS: Record<string, { severity: AlertSeverity; filedBy: string | null }>;
export const NOT_ALERT_LABELS: Record<string, string>;
export const ALERT_LABELS: string[];
type IssueLike = { title?: string; labels?: (string | { name?: string })[] };
export function alertLabelOf(issue: IssueLike): string | null;
export function alertWorkflowOf(issue: IssueLike, byTitle?: (title: string) => string | null | undefined): string | null;
