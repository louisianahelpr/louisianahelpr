export interface WebhookEndpoint {
  id: string;
  url: string;
  status: string;
  livemode: boolean;
  created?: number;
  enabled_events?: string[];
}
export function gradeConfigCheckResponse(
  body: { keyIsLive?: unknown; endpoints?: WebhookEndpoint[]; undelivered?: unknown } | null | undefined,
  handlers: string[],
  url: string,
): { failures: string[]; notes: string[] };
export function gradeLiveEndpoints(
  list: { data?: WebhookEndpoint[] } | null | undefined,
  handlers: string[],
  url: string,
): { failures: string[]; notes: string[] };

export function endpointKey(u: unknown): string | null;

/** Grades the edge function's `undelivered` block ({since, until, count, truncated, events: [{id, type}]}).
 *  Typed unknown on purpose: anything but a well-formed block is red. */
export function gradeUndelivered(undelivered: unknown): {
  failures: string[];
  notes: string[];
};
