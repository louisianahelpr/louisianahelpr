/**
 * Q2399 (owner 2026-10-25, switch card_hold_at_post, on for test accounts):
 * a job's checkout may only HOLD the poster's card. The job is then
 * payment_status 'held': posted and listed (browse, apply, offers) but not
 * charged until the hire. Journeys that only need a POSTED job accept 'held';
 * every hire charges the held card first, the way the app's Accept does
 * (src/lib/cardHoldCapture.ts: create-payment capture_hold, then the accept).
 */
import type { APIRequestContext } from "@playwright/test";
import { ANON, SUPABASE_URL, type Session } from "./journeys/fixtures";

export { LISTED_PAYMENT_STATUSES, isListedPayment } from "./listedPayment";

/**
 * The hire on a held card, as `helper` (the Helpr the offer names), exactly
 * as the app's Accept does it: create-payment capture_hold runs the hire RPC
 * as the Helpr, charges the held card and completes the hire. Answers
 * "accepted" (the hire is DONE: do not run the accept RPC again) or
 * "not_held" (nothing held: run the accept RPC as before); throws on anything
 * else, the body included, so a hire never runs on an uncharged hold unnoticed.
 */
export async function captureHeldCard(api: APIRequestContext, helper: Session, jobId: string): Promise<string> {
  const r = await api.post(`${SUPABASE_URL}/functions/v1/create-payment`, {
    headers: { apikey: ANON, Authorization: `Bearer ${helper.access_token}`, "Content-Type": "application/json" },
    data: { action: "capture_hold", jobId },
    timeout: 60_000,
  });
  const text = await r.text();
  let state = "";
  let hired: unknown = null;
  try {
    const body = JSON.parse(text) as { state?: unknown; result?: unknown };
    state = String(body.state ?? "");
    hired = body.result ?? null;
  } catch { /* reported with the raw text below */ }
  if (r.status() !== 200 || !["accepted", "not_held"].includes(state)) {
    throw new Error(`capture_hold on ${jobId} answered HTTP ${r.status()} ${text.slice(0, 300)}`);
  }
  // "accepted" means the server's hire RPC returned no error, which includes a
  // PENDING accept (accept_job_offer's { state: "pending_setup" }): that is not
  // a hire, so it fails here instead of a caller assuming one (Q2399 round 2,
  // silent #5).
  const hiredState = hired && typeof hired === "object" ? (hired as { state?: unknown }).state : undefined;
  if (state === "accepted" && typeof hiredState === "string" && hiredState !== "accepted") {
    throw new Error(`capture_hold on ${jobId} charged the card but the hire answered ${JSON.stringify(hired)}, not "accepted" (the Helpr's setup is no longer complete?)`);
  }
  return state;
}
