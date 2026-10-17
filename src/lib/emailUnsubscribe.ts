/**
 * Q1655: the /unsubscribe page's half of the email opt-out.
 *
 * The email footer's link GETs the email-unsubscribe edge function, which
 * writes NOTHING on a GET (mail scanners and link previewers GET every URL in
 * a message) and answers 303 to /unsubscribe with the signed `e`, `sig` and
 * `list`. This page asks first; only its button POSTs `action=unsubscribe`
 * (and, after, `action=resubscribe`) back to the function, which verifies the
 * signature exactly as it does for a mail client's RFC 8058 one-click POST.
 *
 * Plain `fetch`, not the Supabase client: the function needs no session
 * (verify_jwt = false; the HMAC in the link is the credential), and a
 * form-encoded POST with no custom header is a CORS "simple request", so no
 * preflight either.
 */

export type UnsubscribeList = "promotions" | "job_matches";

export type UnsubscribeLink = { e: string; sig: string; list: UnsubscribeList };

/** The signed parameters from the page URL, or null when either half is missing. */
export function parseUnsubscribeLink(search: string): UnsubscribeLink | null {
  const q = new URLSearchParams(search);
  const e = q.get("e");
  const sig = q.get("sig");
  if (!e || !sig) return null;
  return { e, sig, list: q.get("list") === "job_matches" ? "job_matches" : "promotions" };
}

/**
 * The address the link names, for display only (the server decides what is
 * written). `e` is base64url of the address; anything that does not decode to
 * something address-shaped shows as null.
 */
export function addressFromLink(e: string): string | null {
  try {
    const b64 = e.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    const addr = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr) ? addr : null;
  } catch {
    // Not base64url, or not UTF-8: show "this address" instead of a guess.
    return null;
  }
}

export type UnsubscribeOutcome =
  | { ok: true; status: "unsubscribed" | "resubscribed" }
  | { ok: false; reason: "invalid_link" | "unavailable" | "failed" | "network" };

/** POST the page's choice. Never throws: every failure is an outcome to show. */
export async function sendUnsubscribeChoice(
  functionsBase: string,
  link: UnsubscribeLink,
  action: "unsubscribe" | "resubscribe",
  fetchImpl: typeof fetch = fetch,
): Promise<UnsubscribeOutcome> {
  // The signed link travels in the BODY, never the URL: a request URL is what
  // Sentry breadcrumbs and session replay record (lh-authz-rls, Q1655 #1).
  const form = new URLSearchParams({ action, e: link.e, sig: link.sig });
  if (link.list === "job_matches") form.set("list", "job_matches");
  let res: Response;
  try {
    res = await fetchImpl(`${functionsBase.replace(/\/+$/, "")}/functions/v1/email-unsubscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
  } catch {
    // Offline or blocked. The answer is unknown (a dropped connection can
    // follow a write), so the page says it "may not have saved"; a retry is
    // safe because both writes are idempotent.
    return { ok: false, reason: "network" };
  }
  let body: { status?: string; error?: string } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // A non-JSON answer (an old deploy, a gateway error page) is a failure,
    // never read as success.
    body = {};
  }
  const want = action === "resubscribe" ? "resubscribed" : "unsubscribed";
  if (res.ok && body.status === want) return { ok: true, status: want };
  if (body.error === "invalid_link" || body.error === "unavailable") return { ok: false, reason: body.error };
  return { ok: false, reason: "failed" };
}
