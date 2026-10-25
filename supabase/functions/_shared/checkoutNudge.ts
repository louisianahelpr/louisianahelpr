/**
 * The abandoned-checkout nudge (lead, 2026-10-25): ONE "Finish posting your
 * job" notice, in the app and by email, when a new job's checkout expires
 * unpaid. Called by stripe-webhook's checkout.session.expired handler after it
 * has released the job's session hold; migration 20261025170841 holds the claim
 * table and the hidden switch.
 *
 * Order, and why:
 *   1+2. public.claim_checkout_nudge: the switch for this poster (unless the
 *      owner approved this one job, checkout-nudge-backfill), the job's own
 *      state (the poster's open, never-paid job) and the claim
 *      (public.job_checkout_nudges, primary key job_id), in ONE call, BEFORE
 *      the notice, so a re-delivered event, two of the job's sessions
 *      expiring, two workers or a second backfill never nudge it twice;
 *   3. the in-app notice (.select("id"): the seed boundary trigger drops a
 *      seed job's row, which is by design and ends here);
 *   4. the email through send-notification-email, which applies the member's
 *      job-update email switch, the suppression list and the test-recipient
 *      gate. Its outcome is stamped on the claim.
 *
 * Never throws: a nudge is never worth failing the money event that carries
 * it (the hold release before it is already written). Every outcome is
 * returned and logged by the caller. Guard:
 * src/test/edge/checkoutNudge.test.ts.
 */
import { caughtMessage } from "./caughtMessage.ts";
import { fetchFunction } from "./functionFetch.ts";

// deno-lint-ignore no-explicit-any
type Client = any;

export const CHECKOUT_NUDGE_SWITCH = "checkout_nudge";
export const CHECKOUT_NUDGE_TITLE = "Finish posting your job";

/** The notice's words. Nothing was charged, and the form opens with the job filled in. */
export function checkoutNudgeMessage(jobTitle: string | null | undefined): string {
  const t = (jobTitle ?? "").trim();
  const what = t ? `"${t}"` : "Your job";
  return `${what} isn't posted yet because checkout wasn't finished, and you weren't charged. Open it to check the details and pay when you're ready.`;
}

/** Back to Post a job with this job's details filled in (the rebook loader reads the poster's own row). */
export function checkoutNudgeLink(jobId: string): string {
  return `/post-job?rebook=${encodeURIComponent(jobId)}`;
}

export type CheckoutNudgeStatus =
  | "switch_off"   // the hidden switch is off for this poster: nothing done
  | "duplicate"    // this job was nudged before
  | "not_nudgeable" // not this poster's open, never-paid job (funded, cancelled, gone)
  | "dropped"      // the seed boundary dropped the in-app row by design (a seed job)
  | "sent"         // in-app row written; `emailed` says whether the email went
  | "failed";      // something broke; `error` says what (the caller logs it)

export interface CheckoutNudgeResult {
  status: CheckoutNudgeStatus;
  emailed?: boolean;
  /** The member's own switches, the suppression list or the test gate held the email: not a fault. */
  emailSkipped?: boolean;
  error?: string;
}

export interface CheckoutNudgeInput {
  jobId: string;
  customerId: string;
  title: string | null;
  sessionId: string | null;
  /** Where send-notification-email lives; read from Deno.env when absent (tests pass one). */
  endpoint?: { url: string; key: string } | null;
  /**
   * The owner approved this ONE job (checkout-nudge-backfill, service role
   * only): send it whatever the switch says. The claim still makes it once.
   */
  ownerApprovedJob?: boolean;
}

function envEndpoint(): { url: string; key: string } | null {
  // deno-lint-ignore no-explicit-any
  const env = (globalThis as any).Deno?.env;
  const url = env?.get?.("SUPABASE_URL");
  const key = env?.get?.("SECRET_KEY") ?? env?.get?.("SUPABASE_SERVICE_ROLE_KEY");
  return url && key ? { url, key } : null;
}

export async function sendCheckoutNudge(supabase: Client, input: CheckoutNudgeInput): Promise<CheckoutNudgeResult> {
  try {
    // The switch, the job's own state and the once-per-job claim, decided in
    // ONE database call (public.claim_checkout_nudge).
    const { data: claim, error: claimErr } = await supabase.rpc("claim_checkout_nudge", {
      p_job_id: input.jobId,
      p_user_id: input.customerId,
      p_session_id: input.sessionId,
      p_owner_approved: input.ownerApprovedJob === true,
    });
    if (claimErr) return { status: "failed", error: `claim: ${claimErr.message}` };
    if (claim === "switch_off") return { status: "switch_off" };
    if (claim === "duplicate") return { status: "duplicate" };
    if (claim === "not_nudgeable") return { status: "not_nudgeable" };
    if (claim !== "claimed") return { status: "failed", error: `claim answered ${JSON.stringify(claim)}` };

    const title = CHECKOUT_NUDGE_TITLE;
    const message = checkoutNudgeMessage(input.title);
    const link = checkoutNudgeLink(input.jobId);
    const { data: rows, error: nErr } = await supabase.from("notifications").insert({
      user_id: input.customerId,
      // The subject: the seed boundary drops the row for a seed job.
      job_id: input.jobId,
      title,
      message,
      type: "job_update",
      link,
    }).select("id");
    if (nErr) {
      await stamp(supabase, input.jobId, { email_note: `notice not written: ${nErr.message}` });
      return { status: "failed", error: `notice: ${nErr.message}` };
    }
    const notificationId = (rows ?? [])[0]?.id as string | undefined;
    if (!notificationId) {
      await stamp(supabase, input.jobId, { email_note: "dropped by the seed boundary" });
      return { status: "dropped" };
    }

    const ep = input.endpoint ?? envEndpoint();
    const sent = await postEmail(ep, {
      notification_id: notificationId, user_id: input.customerId, title, message,
      type: "job_update", link, job_id: input.jobId,
    });
    await stamp(supabase, input.jobId, { notification_id: notificationId, emailed: sent.emailed, email_note: sent.note ?? null });
    return { status: "sent", emailed: sent.emailed, emailSkipped: sent.skipped, error: sent.skipped ? undefined : sent.note };
  } catch (e) {
    return { status: "failed", error: caughtMessage(e) };
  }
}

async function stamp(supabase: Client, jobId: string, fields: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from("job_checkout_nudges").update(fields).eq("job_id", jobId).select("job_id");
  if (error) console.error("[checkoutNudge] stamp failed", { jobId, message: error.message }); // logged, the notice itself stands
}

async function postEmail(
  ep: { url: string; key: string } | null,
  payload: Record<string, unknown>,
): Promise<{ emailed: boolean; skipped: boolean; note?: string }> {
  if (!ep) return { emailed: false, skipped: false, note: "no SUPABASE_URL / service key to reach send-notification-email" };
  try {
    const res = await fetchFunction(`${ep.url}/functions/v1/send-notification-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ep.key}` },
      body: JSON.stringify(payload),
    }, {
      deadlineAt: Date.now() + 20_000,
      fetchImpl: (u, i) => fetch(u, { ...i, signal: AbortSignal.timeout(12_000) }),
    });
    const body = await res.json().catch(() => ({})) as { skipped?: boolean; reason?: string; success?: boolean; error?: string };
    if (!res.ok) return { emailed: false, skipped: false, note: `send-notification-email answered ${res.status}` };
    if (body.skipped) return { emailed: false, skipped: true, note: `skipped: ${body.reason ?? "unknown"}` };
    if (body.success === false) return { emailed: false, skipped: false, note: `send failed: ${body.error ?? body.reason ?? "unknown"}` };
    return { emailed: true, skipped: false };
  } catch (e) {
    return { emailed: false, skipped: false, note: caughtMessage(e) };
  }
}
