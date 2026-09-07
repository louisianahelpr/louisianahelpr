import { Wallet, RefreshCw, Loader2, Banknote, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCents } from "./earningsTabHelpers";
import { TIER_PERKS } from "@/lib/subscriptionTiers";
import {
  instantPayoutFeeLabel,
  instantPayoutMinLabel,
  INSTANT_PAYOUT_MIN_CENTS,
} from "@/lib/instantPayoutFee";
import type { StripePayoutData } from "./types";

// EarningsTab only mounts this card once Stripe is connected and loaded —
// it owns the loading skeleton, and the disconnected state renders the
// Payout & payments connect card instead. So this component has exactly one
// state: a live, connected wallet.
interface WalletCardProps {
  stripeData: StripePayoutData;
  refreshing: boolean;
  availableTotal: number;
  pendingTotal: number;
  canUseInstantPayout: boolean;
  onRefresh: () => void;
  onCashOut: () => void;
  onUpgrade: () => void;
}

export function WalletCard({
  stripeData,
  refreshing,
  availableTotal,
  pendingTotal,
  canUseInstantPayout,
  onRefresh,
  onCashOut,
  onUpgrade,
}: WalletCardProps) {
  return (
    <div className="rounded-2xl liquid-glass p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Wallet className="w-4 h-4 text-primary" />
          </div>
          <div className="flex items-center gap-2">
            <h2 className="font-display italic font-bold leading-tight text-ds-17" style={{ color: "hsl(var(--ink-deep))" }}>
              Wallet
            </h2>
            <span className="text-ds-9 font-bold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary" style={{ letterSpacing: "0.05em" }}>LIVE</span>
          </div>
        </div>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          aria-label="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <Banknote className="w-3 h-3 text-primary" />
            {/* Owner removed the small-caps eyebrow; kept sr-only so the money
                figure still announces which balance it is. Sighted users get
                it from the icon + the "ready to pay out" line below. */}
            <span className="sr-only">Available</span>
          </div>
          <p className="font-display italic font-bold tabular-nums leading-none text-ds-28" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}>
            {formatCents(Math.max(0, availableTotal))}
          </p>
          {/* A NEGATIVE Stripe balance is a real state, and it used to render
              verbatim as "-$2.07 · ready to pay out" — money the helper does
              not have, described as money they can withdraw. It happens after
              an Instant Payout: the payout drains the balance to zero and
              Stripe then debits its own instant-payout fee against it, so the
              connected account goes short by that fee and (payouts are on a
              manual schedule) stays there until the next job pays in.
              Show nothing available, and SAY what the shortfall is — clamping
              it away silently would leave the next payment mysteriously light. */}
          {availableTotal < 0 ? (
            <p className="font-serif italic mt-1 text-ds-12" style={{ color: "hsl(var(--burnt-sienna))" }}>
              {formatCents(Math.abs(availableTotal))} owed from your last instant
              payout&apos;s fee — it comes out of your next payment
            </p>
          ) : (
            <p className="font-serif italic mt-1 text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              ready to pay out
            </p>
          )}
        </div>
        <div className="border-l border-border/40 pl-4">
          <div className="flex items-center gap-1.5 mb-1">
            <Loader2 className="w-3 h-3" style={{ color: "hsl(var(--olivewood) / 0.8)" }} />
            {/* See the "Available" note above — sr-only for the same reason. */}
            <span className="sr-only">Pending</span>
          </div>
          <p className="font-display italic font-bold tabular-nums leading-none text-ds-28" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}>
            {formatCents(Math.max(0, pendingTotal))}
          </p>
          <p className="font-serif italic mt-1 text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            clearing soon
          </p>
        </div>
      </div>

      {/* THE "Released, on its way" ROW MOVED TO <EarningsSummaryCard /> on
          2026-09-06, and it is not coming back here. This card does not mount
          until Stripe is connected (see the note above the props), so stating
          approved-but-not-yet-transferred money here hid it from precisely the
          helper who has finished a job and not finished payout setup. It now
          sits in the Earned card directly above, which always renders.

          What stays here is Stripe's own two balances, and only those: a
          figure inside a card headed "Wallet · LIVE" must be one Stripe would
          agree with. */}

      {(() => {
        // Same reason as Available above: Stripe reports raw cents and this
        // bucket can go negative too. `<= 0` already hides the card, but the
        // clamp keeps the figure from ever being rendered as negative money if
        // that guard is ever loosened.
        const instantAvailable = Math.max(
          0,
          (stripeData.instant_available ?? []).reduce((s, b) => s + b.amount, 0),
        );
        if (instantAvailable <= 0) return null;
        // Subscribed helpers still can't cash out below the minimum — a flat 3%
        // doesn't clear Stripe's per-instant-payout cost on tiny balances. Their
        // funds pay out free on the standard schedule; instant unlocks at the
        // threshold. Mirrors the server-side gate in instant-payout/index.ts.
        const belowMin = canUseInstantPayout && instantAvailable < INSTANT_PAYOUT_MIN_CENTS;
        const subCopy = !canUseInstantPayout
          ? "Subscribe to unlock instant payouts"
          : belowMin
          ? `Instant unlocks at ${instantPayoutMinLabel()} — smaller balances pay out free on the standard schedule`
          : `~30 min · ${instantPayoutFeeLabel()}`;
        return (
          <div className="mt-3 rounded-ds-md border border-primary/30 bg-gradient-to-br from-primary/10 to-primary/5 p-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              {/* flex-wrap + nowrap on the label: at 320px "Instant cash out"
                  was breaking across THREE lines ("Instant / cash / out") to
                  make room for the BASIC chip beside it, which also dropped
                  the Zap icon off the row. The words now stay intact and the
                  chip moves to its own line instead. */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <Zap className="w-3.5 h-3.5 text-primary shrink-0" />
                <span className="text-ds-11 font-semibold text-foreground whitespace-nowrap">Instant cash out</span>
                {!canUseInstantPayout && (
                  <span
                    className="text-ds-9 font-bold uppercase tracking-wider px-1 py-0.5 rounded-full"
                    style={{
                      background: "hsl(var(--burnt-sienna) / 0.14)",
                      color: "hsl(var(--burnt-sienna))",
                      letterSpacing: "0.06em",
                    }}
                  >
                    {/* Basic is the cheapest tier that unlocks instant
                        payouts (TIER_PERKS.basic) — the chip names the real
                        gate, matching the paywall sheet. */}
                    {TIER_PERKS.basic.name}
                  </span>
                )}
              </div>
              <p className="text-ds-15 font-bold text-foreground">{formatCents(instantAvailable)}</p>
              <p className="text-muted-foreground text-ds-11">{subCopy}</p>
            </div>
            <Button
              size="sm"
              disabled={belowMin}
              onClick={() => {
                if (belowMin) return;
                if (canUseInstantPayout) onCashOut();
                else onUpgrade();
              }}
              className="h-8 text-ds-11 gap-1.5 shrink-0"
            >
              <Zap className="w-3.5 h-3.5" /> Cash Out
            </Button>
          </div>
        );
      })()}

      {!stripeData.payouts_enabled && (
        <p className="mt-2 text-ds-11 text-[hsl(var(--destructive-ink))]">
          Payouts not yet enabled — finish setup to start receiving funds.
        </p>
      )}
    </div>
  );
}
