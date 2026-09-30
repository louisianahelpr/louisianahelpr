export interface WebhookEndpoint {
  id: string;
  url: string;
  status: string;
  livemode: boolean;
  created: number;
  enabled_events?: string[];
}
export function liveReadKeyProblem(key: string | undefined | null): string | null;
export function gradeLiveEndpoints(
  list: { data?: WebhookEndpoint[] } | null | undefined,
  handlers: string[],
  url: string,
): { failures: string[]; notes: string[] };
