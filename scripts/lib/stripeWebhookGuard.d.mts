export interface WebhookEndpoint {
  id: string;
  url: string;
  status: string;
  livemode: boolean;
  created?: number;
  enabled_events?: string[];
}
export function gradeConfigCheckResponse(
  body: { keyIsLive?: unknown; endpoints?: WebhookEndpoint[] } | null | undefined,
  handlers: string[],
  url: string,
): { failures: string[]; notes: string[] };
export function gradeLiveEndpoints(
  list: { data?: WebhookEndpoint[] } | null | undefined,
  handlers: string[],
  url: string,
): { failures: string[]; notes: string[] };

export function endpointKey(u: unknown): string | null;
