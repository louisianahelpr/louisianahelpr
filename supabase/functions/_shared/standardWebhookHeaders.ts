/**
 * The three Standard Webhooks headers Supabase Auth signs every hook call with
 * (the Standard Webhooks spec). Auth never calls without them.
 */
export const STANDARD_WEBHOOK_HEADERS = ["webhook-id", "webhook-timestamp", "webhook-signature"] as const;

/**
 * True when every Standard Webhooks header is present and non-empty.
 *
 * A request missing any of them is not Supabase Auth with a stale secret: it
 * is a stranger calling the public function URL, and it can never verify. The
 * auth email hook refuses it WITHOUT paging, and keeps the "bad signature"
 * alert for a signed call that fails verification, the one real sign that
 * SEND_EMAIL_HOOK_SECRET no longer matches. 2026-10-02 12:44Z: the day's only
 * "bad signature" alert was a GET from python-httpx at a Helsinki host, while
 * Auth's own four POSTs (Go-http-client, AWS) all sent.
 */
export function carriesStandardWebhookHeaders(get: (name: string) => string | null): boolean {
  return STANDARD_WEBHOOK_HEADERS.every((name) => (get(name) ?? "").trim() !== "");
}
