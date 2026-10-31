import { useQuery } from "@tanstack/react-query";
import { usePayoutSetupPaused } from "@/hooks/usePayoutSetupPaused";
import { PayoutSetupPausedNotice } from "@/components/payouts/PayoutSetupPausedNotice";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { ProfileTabBody } from "@/components/profile/ProfileTabBody";
import { ProfileTabHeader } from "@/components/profile/ProfileTabHeader";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { ProfileTabBodyReserve } from "@/components/profile/ProfileTabFallback";
import { functionInvokeError } from "@/lib/supabaseResult";
import { report } from "@/lib/errorLogger";
import { useEarningsData } from "@/components/profile/earningsTab/useEarningsData";
import { formatCents } from "@/components/profile/earningsTab/earningsTabHelpers";
import type { StripePayout } from "@/components/profile/earningsTab/types";
import { TAB_TITLES } from "@/pages/profile/types";

/**
 * Board 177, PAYOUT HISTORY and ONE PAYOUT (You → Money → Payout history).
 *
 * The list is the bank payouts stripe-payouts already reads for the wallet
 * (Stripe's last 20, same query key, so it is usually cached). A row opens
 * that payout's lines (`?payout=po_…`), which stripe-payouts names from the
 * caller's own ledgers (payoutDetail.ts): each job or sale it carried, any fee
 * owed it paid back, and the bank it went to.
 */

const NO_PAYOUTS_YET = "No payouts yet. When Stripe sends money to your bank, it shows here.";

interface PayoutLine {
  kind: string;
  label: string;
  amount_cents: number;
  href: string | null;
}
interface PayoutDetail {
  id: string;
  amount_cents: number;
  currency: string;
  status: string;
  arrival_date: number;
  created: number;
  bank_last4: string | null;
  lines: PayoutLine[];
}

/** "Fri, Oct 23" — the payout's arrival day, in the viewer's zone. */
function payoutDay(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/** Stripe's payout status in the board's words. */
function payoutStatusLabel(status: string): string {
  switch (status) {
    case "paid": return "Sent";
    case "in_transit": return "On the way";
    case "pending": return "Scheduled";
    case "failed": return "Didn't go through";
    case "canceled": return "Canceled";
    default: return status;
  }
}

const PAYOUT_ID = /^po_[A-Za-z0-9]{6,64}$/;

const card = "rounded-2xl liquid-glass";
const ink = { color: "hsl(var(--ink-deep))" };
const quiet = { color: "hsl(var(--olivewood) / 0.7)" };
const rust = { color: "hsl(var(--accent-ink))" };

function PayoutRow({ p, onOpen }: { p: StripePayout; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-payout-row={p.id}
      className={`${card} w-full px-4 py-3 flex items-center gap-3 text-left active:scale-[0.99] transition-transform`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-ds-14 font-semibold" style={ink}>{payoutDay(p.arrival_date)}</span>
        <span className="block text-ds-12 mt-0.5" style={quiet}>{payoutStatusLabel(p.status)}</span>
      </span>
      <span className="shrink-0 font-bold tabular-nums text-ds-15" style={rust}>{formatCents(p.amount, p.currency)}</span>
    </button>
  );
}

function PayoutDetailView({ payoutId }: { payoutId: string }) {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const { data, isLoading, isError, isFetching, refetch } = useQuery<PayoutDetail>({
    queryKey: ["stripe-payouts", "detail", user?.id, payoutId],
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<PayoutDetail>("stripe-payouts", { body: { payout_id: payoutId } });
      if (error) {
        const err = await functionInvokeError(error);
        report(err, { severity: "warning", tags: { source: "PayoutHistory.detail" } });
        throw err;
      }
      if (!data) throw new Error("empty payout detail");
      return data;
    },
  });

  if (isLoading) return <Skeleton data-testid="payout-detail-bones" className="h-40 w-full rounded-2xl" />;
  if (isError || !data) {
    return (
      <ErrorState
        variant="inline"
        title="We couldn't load this payout."
        body="Your money is fine; the page just couldn't reach it. Tap Try again."
        onRetry={() => { void refetch(); }}
        retryDisabled={isFetching}
      />
    );
  }
  return (
    <div className="space-y-2">
      <div data-payout-detail={data.id} className={`${card} px-4 py-3`}>
        {data.lines.length === 0 ? (
          <p className="text-ds-13" style={quiet}>Stripe didn't list what this payout carried.</p>
        ) : (
          <ul>
            {data.lines.map((l, i) => (
              <li key={`${l.kind}-${i}`} className="flex items-center justify-between gap-3 text-ds-13 min-h-11">
                {l.href ? (
                  <button type="button" className="text-left min-w-0 truncate" style={ink} title={l.label} onClick={() => navigate(l.href!)}>
                    {l.label}
                  </button>
                ) : (
                  <span className="min-w-0 truncate" style={ink}>{l.label}</span>
                )}
                <span className="shrink-0 font-semibold tabular-nums" style={rust}>
                  {l.amount_cents < 0 ? `−${formatCents(-l.amount_cents, data.currency)}` : formatCents(l.amount_cents, data.currency)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 pt-2 flex items-center justify-between gap-3" style={{ borderTop: "1px solid hsl(var(--border))" }}>
          <span className="min-w-0" style={ink}>
            {/* AUD31-54: the detail ignored data.status, so a failed payout read "To bank ending 6789" like a sent one. */}
            <span className="block font-bold text-ds-15">
              {data.status === "paid" ? "Sent to " : "To "}
              {data.bank_last4 ? `bank ending ${data.bank_last4}` : "your bank"}
            </span>
            <span data-payout-status={data.status} className="block text-ds-12 mt-0.5" style={data.status === "failed" ? rust : quiet}>
              {payoutStatusLabel(data.status)}
            </span>
          </span>
          <span className="font-bold tabular-nums text-ds-20" style={rust}>{formatCents(data.amount_cents, data.currency)}</span>
        </div>
      </div>
      {data.status === "failed" && (
        <p className="text-ds-13 px-1" style={ink}>
          Your bank didn't take this payout.{" "}
          <Link to="/profile?tab=payment" className="underline font-semibold">Check your bank details</Link>
        </p>
      )}
      {data.lines.some((l) => l.href) && (
        <p className="text-ds-12 px-1" style={quiet}>Each line opens the job or sale with its own breakdown.</p>
      )}
    </div>
  );
}

export default function PayoutHistory({ onBack }: { onBack?: () => void }) {
  const { user } = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const raw = params.get("payout");
  const payoutId = raw && PAYOUT_ID.test(raw) ? raw : null;
  const { stripeData, stripeLoading, stripeError, refreshing, handleRefresh } = useEarningsData(user?.id ?? "");
  // Owner ruling 2026-10-23: payout setup is paused; no "set up payouts" ask.
  const setupPaused = usePayoutSetupPaused();
  const payouts = stripeData?.payouts ?? [];
  const open = payoutId ? payouts.find((p) => p.id === payoutId) : undefined;

  const openPayout = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("payout", id);
    setParams(next);
  };
  const closePayout = () => {
    const next = new URLSearchParams(params);
    next.delete("payout");
    setParams(next);
  };

  if (payoutId) {
    return (
      <ProfileTabBody>
        <ProfileTabHeader title={open ? `Payout · ${payoutDay(open.arrival_date)}` : "Payout"} onBack={closePayout} />
        <PayoutDetailView payoutId={payoutId} />
      </ProfileTabBody>
    );
  }

  return (
    <ProfileTabBody>
      <ProfileTabHeader title={TAB_TITLES.payout_history} onBack={onBack} />
      {stripeLoading ? (
        // The same clothes the tab's chunk waited in (ProfileTabFallback's TAB_SHAPES), so one placeholder, not two.
        <ProfileTabBodyReserve tab="payout_history" />
      ) : stripeError ? (
        <ErrorState
          variant="inline"
          title="We couldn't load your payouts."
          body="Your money is fine; the page just couldn't reach it. Tap Try again."
          onRetry={handleRefresh}
          retryDisabled={refreshing}
        />
      ) : !stripeData?.connected && setupPaused ? (
        // The notice speaks only for "not hired yet" and is silent while setup is switched off for
        // everyone (owner 2026-10-25), so the tab says what it holds itself: alone, it rendered only
        // its title (ui-sweep BLANK_SCREEN, nightly-red #3491). Guard: payoutHistoryNotConnected.test.tsx.
        <>
          <PayoutSetupPausedNotice compact />
          <p className="text-ds-13 px-1" style={quiet}>{NO_PAYOUTS_YET}</p>
        </>
      ) : !stripeData?.connected ? (
        <p className="text-ds-13 px-1" style={quiet}>Set up payouts on the Money page and your bank payouts will show here.</p>
      ) : payouts.length === 0 ? (
        <p className="text-ds-13 px-1" style={quiet}>{NO_PAYOUTS_YET}</p>
      ) : (
        <div className="space-y-2">
          {payouts.map((p) => <PayoutRow key={p.id} p={p} onOpen={() => openPayout(p.id)} />)}
        </div>
      )}
    </ProfileTabBody>
  );
}
