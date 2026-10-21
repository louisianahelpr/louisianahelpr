import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import AppPage from "@/components/AppPage";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useFirstPayoutFeeDollars } from "@/hooks/useFirstPayoutFee";
import { computeNet } from "@/components/dashboard/JobPrice";
import { helperFeePercentOrLegacy } from "@/lib/legacyFeeFallback";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { Gift } from "lucide-react";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import { tipChargeBreakdown } from "../../../supabase/functions/_shared/tipFees";

const MONEY = { color: "hsl(var(--sienna-ink))" };
const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

interface TipMomentData {
  tip: { id: string; amount: number; job_id: string; tipper_id: string; helper_id: string; payment_status: string };
  job: { title: string; budget: number; urgent_fee: number | null; helpers_needed: number | null; is_group_job: boolean | null; status: string; payment_status: string | null; disputed_at: string | null; helper_fee_flat_cents: number | null; helper_fee_percent: number | null } | null;
  paidCents: number | null;
  tipperFirst: string;
}

/**
 * Board 181, the Helpr's moment: "Lexi tipped you $13.50", all of it theirs
 * (the tip is charged on its own, card processing on top: tipChargeBreakdown,
 * the function the server charges with), the job's take-home beside it, and
 * "Say thanks" into the deal room. The job line is what was actually paid to
 * them when a transfer exists, else the take-home the ONE money function
 * computes (computeNet, as JobPrice). No payout date is named: bank timing is
 * Stripe's schedule, and a date we cannot vouch for is not printed.
 */
export default function TipMoment() {
  const { tipId } = useParams<{ tipId: string }>();
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const firstPayoutFee = useFirstPayoutFeeDollars();
  const q = useQuery({
    queryKey: ["tip-moment", tipId, user?.id],
    enabled: !!tipId && !!user,
    queryFn: async (): Promise<TipMomentData | null> => {
      const tip = unwrap(await supabase.from("tips").select("id, amount, job_id, tipper_id, helper_id, payment_status").eq("id", tipId!).maybeSingle());
      if (!tip) return null;
      const [jobRes, paidRes, tipperRes] = await Promise.all([
        supabase.from("jobs").select("title, budget, urgent_fee, helpers_needed, is_group_job, status, payment_status, disputed_at, helper_fee_flat_cents, helper_fee_percent").eq("id", tip.job_id).maybeSingle(),
        supabase.from("payout_transfers").select("amount_cents").eq("job_id", tip.job_id).eq("helper_id", tip.helper_id).eq("status", "paid"),
        supabase.rpc("get_safe_profiles", { user_ids: [tip.tipper_id] }),
      ]);
      const job = unwrap(jobRes);
      const paid = unwrap(paidRes) ?? [];
      const tipper = (unwrap(tipperRes) ?? []) as { user_id: string; full_name: string | null }[];
      const name = tipper.find((p) => p.user_id === tip.tipper_id)?.full_name ?? "";
      return {
        tip: tip as TipMomentData["tip"],
        job: job as TipMomentData["job"],
        paidCents: paid.length ? paid.reduce((s, r) => s + Number(r.amount_cents ?? 0), 0) : null,
        tipperFirst: name.trim().split(/\s+/)[0] || "Someone",
      };
    },
  });

  if (q.isLoading) return <AppPage title="Tip" backTo="/home"><div className="flex justify-center py-16"><HelprSpinner /></div></AppPage>;
  if (q.isError) {
    return <AppPage title="Tip" backTo="/home"><ErrorState title="We couldn't load this tip." onRetry={() => void q.refetch()} /></AppPage>;
  }
  if (!q.data || q.data.tip.payment_status !== "paid") {
    return (
      <AppPage title="Tip" backTo="/home">
        <EmptyState icon={Gift} title={q.data ? "This tip isn't paid yet" : "We can't find this tip"} body={q.data ? "It shows here as soon as the payment goes through." : "It may have been removed, or it isn't yours to see."} />
      </AppPage>
    );
  }
  const { tip, job, paidCents, tipperFirst } = q.data;
  const tipCents = tipChargeBreakdown(Math.round(Number(tip.amount) * 100)).helperCents;
  const isHelpr = user?.id === tip.helper_id;
  // The job's take-home: paid (a transfer row) or the take-home the money function computes, floored as every payout figure is.
  // Estimated only for a job done and awaiting payout, never refunded, cancelled or disputed (money review).
  const estimable = !!job && job.status === "completed" && job.payment_status === "payout_pending" && !job.disputed_at;
  const jobCents = paidCents ?? (estimable && job
    ? Math.floor(computeNet(
        Number(job.budget), helperFeePercentOrLegacy(job.helper_fee_percent), Number(job.urgent_fee ?? 0),
        job.is_group_job && job.helpers_needed ? job.helpers_needed : 1,
        job.status === "disputed" ? 0 : firstPayoutFee,
        { helper_fee_flat_cents: job.helper_fee_flat_cents, helper_fee_percent: job.helper_fee_percent },
      ).netEarnings) * 100
    : null);

  return (
    <AppPage title="Tip" backTo="/home" phoneHidesTitle>
      <div className="flex flex-col items-center text-center gap-2 pt-6" data-testid="tip-moment">
        <h2 className="font-moment text-page-title text-foreground">{isHelpr ? `${tipperFirst} tipped you` : "You left a tip"}</h2>
        <p className="text-ds-40 font-bold leading-none" style={MONEY}>{dollars(tipCents)}</p>
        <p className="text-ds-13 text-muted-foreground">{[job?.title, isHelpr ? "all of it is yours" : null].filter(Boolean).join(" · ")}</p>
      </div>
      {isHelpr && (
        <section aria-label="This job's pay" className="liquid-glass p-card flex flex-col gap-1.5 mt-2">
          {jobCents != null && (
            <div className="flex justify-between text-ds-14"><span>{paidCents != null ? "Job, paid to you" : "Job, you take home"}</span><span className="font-semibold" style={MONEY}>{dollars(jobCents)}</span></div>
          )}
          <div className="flex justify-between text-ds-14"><span>Tip (100%)</span><span className="font-semibold" style={MONEY}>{dollars(tipCents)}</span></div>
          {jobCents != null && (
            <div className="flex justify-between border-t border-border/60 pt-2 mt-1">
              <span className="text-ds-15 font-bold">From this job</span>
              <span className="text-ds-18 font-bold" style={MONEY}>{dollars(jobCents + tipCents)}</span>
            </div>
          )}
        </section>
      )}
      {isHelpr && (
        <button
          type="button"
          onClick={() => navigate(`/messages?jobId=${tip.job_id}&userId=${tip.tipper_id}`)}
          className="btn-grad-primary btn-press w-full rounded-full min-h-14 mt-6 text-ds-16 font-semibold"
        >
          Say thanks
        </button>
      )}
    </AppPage>
  );
}
