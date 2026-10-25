/**
 * Q2399 (owner 2026-10-25): a job whose poster's card is only HELD is charged
 * at the hire. The accepts that complete a hire (accept_job_offer,
 * respond_to_direct_offer, rpc_group_member_confirm) answer
 * `payment_not_captured` on a held job; this asks create-payment's
 * capture_hold to charge the held card and, when it did, runs the accept
 * again. The database refuses a hire on a held card whatever the app does
 * (migration 20261025202148), so this is the way through, never the guard.
 */
import { supabase } from "@/integrations/supabase/client";
import { functionErrorBody } from "@/lib/supabaseResult";
import { report } from "@/lib/errorLogger";

/** True when the database refused a hire because the poster's card is only held. */
export function isPaymentNotCaptured(error: unknown): boolean {
  const e = error as { message?: unknown; hint?: unknown } | null;
  return /payment_not_captured/.test(String(e?.message ?? ""));
}

export type HoldCapture =
  | { kind: "captured" }
  /** Not on a card hold (any more): the accept decides. */
  | { kind: "not_held" }
  /** The Helpr's setup is unfinished: the accept records it as pending, as today. */
  | { kind: "not_ready" }
  /** The poster has to pay again or confirm their card; they were told. */
  | { kind: "waiting"; message: string }
  | { kind: "error"; message: string };

const WAITING_FALLBACK = "This job is waiting on the poster's payment. We've let them know.";

/** Charge the poster's held card for this hire. Never throws. */
export async function captureHeldCard(jobId: string): Promise<HoldCapture> {
  try {
    const { data, error } = await supabase.functions.invoke("create-payment", { body: { action: "capture_hold", jobId } });
    if (error) {
      const body = await functionErrorBody(error);
      if (body?.code === "payment_pending") {
        return { kind: "waiting", message: typeof body.error === "string" && body.error ? body.error : WAITING_FALLBACK };
      }
      return { kind: "error", message: typeof body?.error === "string" && body.error ? body.error : "Couldn't reach payments. Nothing was charged — try again." };
    }
    const state = (data as { state?: string } | null)?.state;
    if (state === "captured") return { kind: "captured" };
    if (state === "not_ready") return { kind: "not_ready" };
    return { kind: "not_held" };
  } catch (err) {
    report(err, { tags: { source: "cardHoldCapture.captureHeldCard" } });
    return { kind: "error", message: err instanceof Error && err.message ? err.message : "Couldn't reach payments. Nothing was charged — try again." };
  }
}

/**
 * Run a hire RPC; when it answers payment_not_captured, charge the held card
 * and run it once more. `holdMessage` is set when the hire is waiting on the
 * poster (or payments could not be reached): the caller shows it instead of
 * the RPC's error.
 */
export async function withCardHoldCapture<R extends { error: unknown }>(
  jobId: string,
  run: () => PromiseLike<R>,
): Promise<R & { holdMessage?: string }> {
  const first = await run();
  if (!first.error || !isPaymentNotCaptured(first.error)) return first;
  const capture = await captureHeldCard(jobId);
  if (capture.kind === "captured" || capture.kind === "not_held" || capture.kind === "not_ready") return await run();
  return { ...first, holdMessage: capture.message };
}
