/**
 * The /unsubscribe page's link to the email-unsubscribe edge function
 * (Q1655, Q?unsub-page-raw-html).
 *
 * Every email footer's unsubscribe link points at the function. A GET of it
 * writes nothing and redirects here with the signed token in the URL fragment (`e`, `sig`, and
 * `list` for the new-job email). This page then:
 *   1. POSTs `action=check`: the function verifies the signature and says whose
 *      address it is, writing nothing (so a scanner that runs the page changes
 *      nothing either);
 *   2. on the member's tap, POSTs `action=unsubscribe`;
 *   3. offers `action=resubscribe` to undo it.
 * The function answers JSON when asked for it (`Accept: application/json`) and
 * stays a plain RFC 8058 one-click endpoint for mail clients.
 *
 * Plain `fetch`, not supabase-js: the function is `verify_jwt = false`, the
 * visitor is usually signed out, and a form-encoded POST with only an Accept
 * header is a CORS "simple" request (no preflight).
 */

export type UnsubscribeList = "promotions" | "job_matches";
export type UnsubscribeAction = "check" | "unsubscribe" | "resubscribe";

export interface UnsubscribeLink {
  e: string;
  sig: string;
  list: UnsubscribeList;
}

export type UnsubscribeResult =
  | { ok: true; action: UnsubscribeAction; list: UnsubscribeList; email: string }
  | { ok: false; error: "invalid_link" | "unavailable" | "failed" | "network" };

/** The signed link from the page's URL fragment (`#e=…&sig=…`), or null when it is not there. */
export function readUnsubscribeLink(fragment: string): UnsubscribeLink | null {
  const q = new URLSearchParams(fragment.replace(/^#/, ""));
  const e = q.get("e");
  const sig = q.get("sig");
  if (!e || !sig) return null;
  return { e, sig, list: q.get("list") === "job_matches" ? "job_matches" : "promotions" };
}

/** The function URL for a link, built exactly as the email built it. */
function unsubscribeFunctionUrl(supabaseUrl: string, link: UnsubscribeLink): string {
  const q = new URLSearchParams({ e: link.e, sig: link.sig });
  if (link.list === "job_matches") q.set("list", "job_matches");
  return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/email-unsubscribe?${q.toString()}`;
}

/**
 * POST one action and read the answer. Never throws: every failure comes back
 * as `{ ok: false }` with a kind the page can word, and a 200 that is not the
 * shape this page expects is "failed", never success.
 */
export async function postUnsubscribe(
  supabaseUrl: string,
  link: UnsubscribeLink,
  action: UnsubscribeAction,
  fetchImpl: typeof fetch = fetch,
): Promise<UnsubscribeResult> {
  let res: Response;
  try {
    res = await fetchImpl(unsubscribeFunctionUrl(supabaseUrl, link), {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ action }).toString(),
    });
  } catch {
    // A transport failure (offline, blocked): the page says to try again.
    return { ok: false, error: "network" };
  }
  type Answer = { ok?: unknown; action?: unknown; list?: unknown; email?: unknown; error?: unknown };
  let body: Answer | null;
  try {
    body = (await res.json()) as Answer;
  } catch {
    // A body that is not JSON (a gateway error page, or the plain one-click
    // text) is graded by its status below, and never as success.
    body = null;
  }
  if (res.ok && body?.ok === true && body.action === action && typeof body.email === "string") {
    return {
      ok: true,
      action,
      list: body.list === "job_matches" ? "job_matches" : "promotions",
      email: body.email,
    };
  }
  if (res.status === 400) return { ok: false, error: "invalid_link" };
  if (res.status === 503) return { ok: false, error: "unavailable" };
  return { ok: false, error: "failed" };
}
