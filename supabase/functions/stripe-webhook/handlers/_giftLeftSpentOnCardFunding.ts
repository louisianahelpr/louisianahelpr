/**
 * Q1983 (lh-money-escrow review of 379780047, #1 follow-up): a gift left 'redeemed' by a checkout that never
 * funded the job (a bank debit that bounced with the gift's return held, or a Q1876 return skipped because the
 * poster's retry moved the job off 'failed') stays spent when the poster's NEXT checkout pays the job by card.
 * The job then reaches escrow while the gift is still 'redeemed' on it: the poster loses the gift, and
 * gift_spent_on_failed_payment (money-reconciliation) no longer sees it because the job is funded.
 *
 * Called right after a job checkout's escrow write matched. That write only matches a job that was NOT funded
 * (payment_status null / unpaid / failed / abandoned) or this same payment again, so a 'redeemed' gift on the job
 * that THIS checkout did not consume (its metadata.gift_card_id is another gift or none) paid for nothing. Ops is
 * paged once a day per gift, naming the job, the poster and the amount; the gift is NOT returned here
 * (return_bounced_gift_card refuses a job that is not 'failed', and its unspendable-donation rules stay in one
 * place). A gift with a replacement already minted for the job (restored_from_job_id, Q2077) is not owed. Seed
 * jobs go to the digest. Never throws: a failed read is logged and pages nothing (the reconciliation run is the
 * backstop for a redelivery).
 *
 * Also called from paymentIntentSucceeded (method "bank") when a bank (ACH) debit that settles later moves the
 * job to escrow: that funding never passes the checkout handler's escrow write, so without this the same gift
 * stayed spent unseen. paymentRef names the checkout session or, there, the PaymentIntent.
 */
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";
import { memberDisplayName } from "../../_shared/memberDisplayName.ts";

type Db = { from: (t: string) => any };

export async function pageGiftLeftSpentOnCardFunding(
  supabase: Db,
  args: {
    jobId: string;
    sessionId: string;
    consumedGiftId: string | null;
    logStep: (m: string, d?: Record<string, unknown>) => void;
    method?: "card" | "bank";
  },
): Promise<"paged" | "none" | "unread"> {
  const { jobId, sessionId, consumedGiftId, logStep } = args;
  const how = args.method === "bank" ? "bank payment" : "card";
  try {
    const { data: gifts, error: giftErr } = await supabase
      .from("gift_cards")
      .select("id, amount, status, job_id")
      .eq("job_id", jobId)
      .eq("status", "redeemed");
    if (giftErr) {
      logStep("WARN: could not read gifts left spent on a card-funded job — no page sent", { jobId, error: giftErr.message });
      return "unread";
    }
    const stale = ((gifts ?? []) as Array<{ id: string; amount: number | string | null; status: string; job_id: string | null }>)
      .filter((g) => g.status === "redeemed" && g.job_id === jobId && g.id !== consumedGiftId);
    if (stale.length === 0) return "none";
    const { data: replacements, error: replErr } = await supabase
      .from("gift_cards")
      .select("id")
      .eq("restored_from_job_id", jobId)
      .limit(1);
    if (replErr) {
      logStep("WARN: could not read replacement gifts for a card-funded job — no page sent", { jobId, error: replErr.message });
      return "unread";
    }
    if (Array.isArray(replacements) && replacements.length > 0) return "none";
    const { data: job } = await supabase
      .from("jobs")
      .select("title, is_seed, customer_id")
      .eq("id", jobId)
      .maybeSingle();
    let poster = "the person who posted it";
    if (job?.customer_id) {
      const { data: prof } = await supabase.from("profiles").select("full_name").eq("user_id", job.customer_id).maybeSingle();
      poster = memberDisplayName(prof?.full_name, "").split(/\s+/)[0] || "the person who posted it";
    }
    const title = (job?.title as string | null | undefined) || "untitled";
    for (const g of stale) {
      const dollars = (Number(g.amount ?? 0) || 0).toFixed(2);
      await postSlackOpsAlert({
        kind: "custom",
        severity: "critical",
        seed: job?.is_seed === true,
        title: `Gift card still spent on a job the poster paid in full by ${how}`,
        message: `Job ${jobId} ("${title}") was just paid in full by ${how}, but ${poster}'s $${dollars} gift card ${g.id} is still marked spent on it from an earlier checkout that never funded the job (a bounced bank payment). ${poster} is owed the gift back. Return it by hand: status 'sent', job_id NULL, redeemed_at NULL, expires_at at least 90 days out, and tell ${poster} it is back.`,
        fields: { job_id: jobId, job_title: title, poster, gift_card_id: g.id, gift_amount: `$${dollars}`,
          ...(args.method === "bank" ? { payment_intent: sessionId } : { session_id: sessionId }) },
        oncePerDayKey: `gift-spent-card-funded:${g.id}`,
      });
    }
    logStep(`Gift left spent on a job funded by ${how} — ops paged`, { jobId, gifts: stale.map((g) => g.id) });
    return "paged";
  } catch (e) {
    // Logged, not rethrown, on purpose: this is a page about a gift, and the card payment that funded the job must
    // still be recorded (a throw would make Stripe redeliver a funding that already succeeded).
    logStep("WARN: gift-left-spent check failed — no page sent", { jobId, error: String(e) });
    return "unread";
  }
}
