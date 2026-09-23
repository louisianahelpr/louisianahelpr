export const SENTRY_SYNC_QUERY: string;
export function sentryReadToken(env: Record<string, string | undefined>): string;
export function sentryIssuesUrl(org: string, project: string, base?: string): string;
export interface SentryIssueLike {
  id?: string; shortId?: string; title?: string; culprit?: string; level?: string;
  status?: string; substatus?: string | null; lastSeen?: string; permalink?: string;
}
export function sentryIssueToAlert(i: SentryIssueLike): {
  sourceKind: "sentry"; source: string; title: string; severity: string; sample: string;
  sampleRef: { sentry_id?: string; short_id: string | null; url?: string; sentry_status: string; sentry_substatus: string | null };
  seenAt?: string;
};
