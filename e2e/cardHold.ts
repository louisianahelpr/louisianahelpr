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
 * The hire's charge of a held card, as `helper` (the Helpr the offer names).
 * Answers "captured" (the job is in escrow now), "not_held" (nothing to
 * charge: the job is funded already) or "not_ready"; throws on anything else,
 * the body included, so a hire never runs on an uncharged hold unnoticed.
 */
export async function captureHeldCard(api: APIRequestContext, helper: Session, jobId: string): Promise<string> {
  const r = await api.post(`${SUPABASE_URL}/functions/v1/create-payment`, {
    headers: { apikey: ANON, Authorization: `Bearer ${helper.access_token}`, "Content-Type": "application/json" },
    data: { action: "capture_hold", jobId },
    timeout: 60_000,
  });
  const text = await r.text();
  let state = "";
  try { state = String((JSON.parse(text) as { state?: unknown }).state ?? ""); } catch { /* reported with the raw text below */ }
  if (r.status() !== 200 || !["captured", "not_held", "not_ready"].includes(state)) {
    throw new Error(`capture_hold on ${jobId} answered HTTP ${r.status()} ${text.slice(0, 300)}`);
  }
  return state;
}
