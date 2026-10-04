import { supabase } from "@/integrations/supabase/client";
import { useInstantQuery } from "@/hooks/useInstantQuery";
import { functionInvokeError } from "@/lib/supabaseResult";
import { report } from "@/lib/errorLogger";

/**
 * A count, or null when the read failed (reported). A refused read used to
 * read as `count: null` -> "0", so the check said ok about rows it never saw;
 * a null makes the check say "unknown" instead (Q1194).
 */
function countOrNull(res: { count: number | null; error: unknown }, check: string): number | null {
  if (res.error) {
    report(res.error, { severity: "warning", tags: { source: "useConfigChecks", check } });
    return null;
  }
  return res.count ?? 0;
}

const unreadable = (id: string, label: string): ConfigCheck => ({
  id,
  label,
  tone: "unknown",
  detail: "Could not read this check's data.",
});

/**
 * The checks an audit would run, run continuously instead.
 *
 * Every item here is a real defect the 2026-08-25 admin audit found by hand,
 * and each shares the property that makes it dangerous: the app looks
 * completely healthy while it is true. Nothing renders wrong, nothing throws,
 * no screen disagrees with another. They are only visible if you go looking —
 * which is why they survived until someone did.
 *
 *   · production running on a Stripe TEST key (checkout renders, webhooks
 *     arrive, revenue displays — no real money can move)
 *   · escrow-funded jobs with no platform_fee_amount recorded
 *   · jobs marked released with no payout_transfers ledger row
 *   · transfers stuck pending long past when they should have settled
 *   · feature-flag keys nothing reads any more
 *
 * The point is not these five rows. It is that a config problem should
 * announce itself on a screen someone already opens, instead of waiting for
 * the next audit.
 */

export type CheckTone = "ok" | "warn" | "danger" | "unknown";

export interface ConfigCheck {
  id: string;
  label: string;
  tone: CheckTone;
  detail: string;
}

/**
 * Flag keys the app actually reads. Anything else stored is a leftover.
 *
 * Emptied 2026-09-07 when `idv_requirement_paused`, the last CLIENT reader,
 * was deleted (identity verification is now unconditional).
 *
 * THE "EVERY OTHER KEY IS A LEFTOVER" CONCLUSION IS WRONG, and this list is
 * the bug, not the comment. It only ever tracked keys read from TypeScript;
 * `seed_jobs_hidden_publicly` is read from POSTGRES —
 * `public.seed_jobs_hidden_publicly()` (migration 20260901035245) is the sole
 * authority for seed-job visibility and four browse surfaces call it. With
 * this array empty the check below reports that key as "nothing reads" it,
 * and the remedy for an orphan key is to delete it — which makes the function
 * COALESCE to false and un-hides the demo fixtures on the public
 * marketplace. That is the launch switch.
 *
 * Adding the key here is the fix; it is deliberately NOT made in this
 * comment-only pass. Until then, treat a "Feature flags" warning naming
 * `seed_jobs_hidden_publicly` as a false positive.
 */
const LIVE_FLAG_KEYS: string[] = [];

export const useConfigChecks = () => {
  return useInstantQuery<ConfigCheck[]>({
    key: ["admin-config-checks"],
    fallback: [],
    fetcher: async () => {
      const checks: ConfigCheck[] = [];

      // ── Stripe mode. Server-side only: the secret never reaches the client,
      // so this asks the admin-gated health-check endpoint for the MODE alone.
      try {
        const { data, error } = await supabase.functions.invoke("health-check");
        if (error) throw await functionInvokeError(error);
        const mode = (data as { checks?: Record<string, string> })?.checks?.stripe_mode;
        checks.push(
          mode === "live"
            ? { id: "stripe", label: "Stripe key", tone: "ok", detail: "Live mode — real payments enabled." }
            : mode === "test"
              ? {
                  id: "stripe",
                  label: "Stripe key",
                  tone: "danger",
                  detail: "Production is running a TEST key. Checkout will look normal and no real money can move.",
                }
              : mode === "missing"
                ? { id: "stripe", label: "Stripe key", tone: "danger", detail: "STRIPE_SECRET_KEY is not set — every payment path is down." }
                : { id: "stripe", label: "Stripe key", tone: "unknown", detail: "Could not read the key mode." },
        );
      } catch {
        checks.push({ id: "stripe", label: "Stripe key", tone: "unknown", detail: "health-check did not respond." });
      }

      // ── Escrow funded but no fee recorded. The fee is written in the same
      // update as the checkout session, so a gap here means a job took money
      // without recording what the platform keeps.
      const feeGapRes = await supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("payment_status", "escrow")
        .not("stripe_payment_intent_id", "is", null)
        .is("platform_fee_amount", null);
      const feeGap = countOrNull(feeGapRes, "fee");
      checks.push(
        feeGap === null
          ? unreadable("fee", "Escrow fee recorded")
          : feeGap > 0
          ? { id: "fee", label: "Escrow fee recorded", tone: "danger", detail: `${feeGap} paid job(s) hold escrow with no platform fee recorded.` }
          : { id: "fee", label: "Escrow fee recorded", tone: "ok", detail: "Every paid job records its platform fee." },
      );

      // ── Released with no ledger row. The payout ledger is what the
      // duplicate-transfer guard reads, so a released job missing from it can
      // be paid twice.
      const releasedRes = await supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("payment_status", "released")
        .not("stripe_payment_intent_id", "is", null);
      const transferRes = await supabase
        .from("payout_transfers")
        .select("id", { count: "exact", head: true });
      const releasedCount = countOrNull(releasedRes, "ledger.released");
      const transferCount = countOrNull(transferRes, "ledger.transfers");
      checks.push(
        releasedCount === null || transferCount === null
          ? unreadable("ledger", "Payout ledger")
          : releasedCount > 0 && transferCount === 0
          ? {
              id: "ledger",
              label: "Payout ledger",
              tone: "danger",
              detail: `${releasedCount} job(s) show released but payout_transfers is empty.`,
            }
          : { id: "ledger", label: "Payout ledger", tone: "ok", detail: `${transferCount ?? 0} transfer row(s) recorded.` },
      );

      // ── Transfers that never settled. stripe-webhook flips these to paid on
      // transfer.paid, so anything still pending after a day never got its
      // webhook or never left Stripe.
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const stuckRes = await supabase
        .from("payout_transfers")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .lt("created_at", dayAgo);
      const stuck = countOrNull(stuckRes, "stuck");
      checks.push(
        stuck === null
          ? unreadable("stuck", "Transfers settling")
          : stuck > 0
          ? { id: "stuck", label: "Transfers settling", tone: "warn", detail: `${stuck} transfer(s) pending for over 24h.` }
          : { id: "stuck", label: "Transfers settling", tone: "ok", detail: "No transfer stuck pending." },
      );

      // ── Leftover flag keys. A stored key nothing reads is a switch that
      // looks operational and does nothing — the exact defect this project
      // shipped for months across five flags.
      const { data: settings, error: settingsError } = await supabase
        .from("platform_settings")
        .select("feature_flags")
        .limit(1)
        .maybeSingle();
      if (settingsError) {
        report(settingsError, { severity: "warning", tags: { source: "useConfigChecks", check: "flags" } });
        checks.push(unreadable("flags", "Feature flags"));
        return checks;
      }
      const stored = Object.keys(
        ((settings as { feature_flags?: Record<string, unknown> } | null)?.feature_flags) ?? {},
      );
      const orphaned = stored.filter((k) => !LIVE_FLAG_KEYS.includes(k));
      checks.push(
        orphaned.length > 0
          ? { id: "flags", label: "Feature flags", tone: "warn", detail: `${orphaned.length} stored key(s) nothing reads: ${orphaned.join(", ")}.` }
          : { id: "flags", label: "Feature flags", tone: "ok", detail: "Every stored flag has a reader." },
      );

      return checks;
    },
  });
};
