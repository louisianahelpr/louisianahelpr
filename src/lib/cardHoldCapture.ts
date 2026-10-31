/**
 * Q2399 (owner 2026-10-25): a job whose poster's card is only HELD is charged
 * at the hire. The accepts that complete a hire (accept_job_offer,
 * respond_to_direct_offer, rpc_group_member_confirm) answer
 * `payment_not_captured` on a held job; create-payment's capture_hold then
 * does the WHOLE hire server-side (runs that same RPC as this Helpr, charges
 * the held card, runs it again) and answers the RPC's own result, so no card
 * is charged for a hire that does not happen. The database refuses a hire on a
 * held card whatever the app does (migration 20261027185146), so this is the
 * way through, never the guard.
 */
import { supabase } from "@/integrations/supabase/client";
import { functionErrorBody } from "@/lib/supabaseResult";
import { report } from "@/lib/errorLogger";

/** True when the database refused a hire because the poster's card is only held. */
function isPaymentNotCaptured(error: unknown): boolean {
  const e = error as { message?: unknown } | null;
  return /payment_not_captured/.test(String(e?.message ?? ""));
}

type HoldCapture =
  /** The hire completed server-side; `result` is the hire RPC's own answer. */
  | { kind: "done"; result: unknown }
  /** Not on a card hold (any more), or the hire was refused for another reason: re-run the RPC for its own answer. */
  | { kind: "not_held" }
  /** The poster has to pay again or confirm their card; they were told. */
  | { kind: "waiting"; message: string }
  /** The request failed; `message` says what is known (never "nothing was charged" unless the server said so). */
  | { kind: "error"; message: string };

const WAITING_FALLBACK = "This job is waiting on payment. We've let the person who posted it know.";
const UNKNOWN = "Couldn't finish your accept. Refresh the page to see where it stands.";

/** The hire on a held card, done by create-payment capture_hold. Never throws. */
async function captureHeldCard(jobId: string): Promise<HoldCapture> {
  try {
    const { data, error } = await supabase.functions.invoke("create-payment", { body: { action: "capture_hold", jobId } });
    if (error) {
      const body = await functionErrorBody(error);
      const said = typeof body?.error === "string" && body.error ? body.error : null;
      if (body?.code === "payment_pending") return { kind: "waiting", message: said ?? WAITING_FALLBACK };
      // A captured card with the hire refused right after is money held for nobody: ops is paged server-side; recorded here too.
      if (body?.code === "captured_not_hired") report(error, { severity: "error", tags: { source: "cardHoldCapture.capturedNotHired", money: "true" }, context: { job_id: jobId } });
      return { kind: "error", message: said ?? UNKNOWN };
    }
    const answer = (data ?? {}) as { state?: string; result?: unknown };
    if (answer.state === "accepted") return { kind: "done", result: answer.result ?? null };
    return { kind: "not_held" };
  } catch (err) {
    report(err, { tags: { source: "cardHoldCapture.captureHeldCard" }, context: { job_id: jobId } });
    return { kind: "error", message: UNKNOWN };
  }
}

/**
 * Run a hire RPC; when it answers payment_not_captured, have capture_hold do
 * the hire (charge the held card, complete the accept) and answer with its
 * result as if the RPC had. `holdMessage` is set when the hire is waiting on
 * the poster or could not be finished: the caller shows it instead of the
 * RPC's error.
 *
 * `knownHeld`: the caller's own read of the job says its card is only held
 * (payment_status 'held'). Then capture_hold goes FIRST, with no RPC call
 * before it that is certain to be refused (audit 2026-10-28 F6: every accept
 * on a held job logged a 403 payment_not_captured, then captured and retried).
 * capture_hold runs the RPC itself, as this Helpr, and answers `not_held` when
 * the job is no longer held, so a stale read costs one extra request, never a
 * charge: the RPC then runs here for its own answer.
 */
export async function withCardHoldCapture<R extends { data?: unknown; error: unknown }>(
  jobId: string,
  run: () => PromiseLike<R>,
  opts: { knownHeld?: boolean } = {},
): Promise<R & { holdMessage?: string }> {
  if (opts.knownHeld) {
    const capture = await captureHeldCard(jobId);
    if (capture.kind === "done") return { data: capture.result, error: null } as R;
    if (capture.kind !== "not_held") return { data: null, error: { message: "payment_not_captured" }, holdMessage: capture.message } as R & { holdMessage?: string };
    return afterNotHeld(await run());
  }
  const first = await run();
  if (!first.error || !isPaymentNotCaptured(first.error)) return first;
  const capture = await captureHeldCard(jobId);
  if (capture.kind === "done") return { ...first, data: capture.result, error: null };
  if (capture.kind === "not_held") return afterNotHeld(await run());
  return { ...first, holdMessage: capture.message };
}

/** capture_hold said the job is not held: the RPC's own answer, unless it is STILL refused as uncaptured. */
function afterNotHeld<R extends { data?: unknown; error: unknown }>(again: R): R & { holdMessage?: string } {
  // Still refused as uncaptured: payments have not caught up; never claim the poster was told.
  return again.error && isPaymentNotCaptured(again.error)
    ? { ...again, holdMessage: "This job's payment isn't ready yet. Try again in a moment." }
    : again;
}
