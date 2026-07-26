import { Wallet, RefreshCw, Loader2, Banknote, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCents } from "./earningsTabHelpers";
import {
  instantPayoutFeeLabel,
  instantPayoutMinLabel,
  INSTANT_PAYOUT_MIN_CENTS,
} from "@/lib/instantPayoutFee";
import type { StripePayoutData } from "./types";

interface WalletCardProps {
  stripeData: StripePayoutData | undefined;
  stripeLoading: boolean;
  refreshing: boolean;
  availableTotal: number;
  pendingTotal: number;
  canUseInstantPayout: boolean;
  onRefresh: () => void;
  onNavigatePayment: () => void;
  onCashOut: () => void;
  onUpgrade: () => void;
}

export function WalletCard({
  stripeData,
  stripeLoading,
  refreshing,
  availableTotal,
  pendingTotal,
  canUseInstantPayout,
  onRefresh,
  onNavigatePayment,
  onCashOut,
  onUpgrade,
}: WalletCardProps) {
  if (stripeLoading) {
    return (
      <div className="rounded-2xl liquid-glass p-5 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Skeleton className="h-3 w-20 rounded" />
            <Skeleton className="h-7 w-24 rounded" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-20 rounded" />
            <Skeleton className="h-7 w-24 rounded" />
          </div>
        </div>
        <Skeleton className="h-9 w-full rounded-md" />
      </div>
    );
  }

  if (!stripeData?.connected) {
    return (
      <div className="rounded-2xl liquid-glass p-5 space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Wallet className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h2 className="font-display italic font-bold leading-tight" style={{ fontSize: "1.05rem", color: "hsl(var(--ink-deep))" }}>
              Wallet
            </h2>
          </div>
        </div>
        <p className="font-serif italic" style={{ fontSize: "0.85rem", color: "hsl(var(--olivewood) / 0.8)" }}>
          Connect your payout account to see your live balance.
        </p>
        <Button variant="bark" size="sm" className="w-full" onClick={onNavigatePayment}>Set up payouts</Button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl liquid-glass p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Wallet className="w-4 h-4 text-primary" />
          </div>
          <div className="flex items-center gap-2">
            <h2 className="font-display italic font-bold leading-tight" style={{ fontSize: "1.05rem", color: "hsl(var(--ink-deep))" }}>
              Wallet
            </h2>
            <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary" style={{ letterSpacing: "0.05em" }}>LIVE</span>
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
            <span className="font-serif italic uppercase" style={{ fontSize: "0.58rem", color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}>
              Available
            </span>
          </div>
          <p className="font-display italic font-bold tabular-nums leading-none" style={{ fontSize: "1.85rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}>
            {formatCents(availableTotal)}
          </p>
          <p className="font-serif italic mt-1" style={{ fontSize: "0.72rem", color: "hsl(var(--olivewood) / 0.8)" }}>
            ready to pay out
          </p>
        </div>
        <div className="border-l border-border/40 pl-4">
          <div className="flex items-center gap-1.5 mb-1">
            <Loader2 className="w-3 h-3" style={{ color: "hsl(var(--olivewood) / 0.8)" }} />
            <span className="font-serif italic uppercase" style={{ fontSize: "0.58rem", color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}>
              Pending
            </span>
          </div>
          <p className="font-display italic font-bold tabular-nums leading-none" style={{ fontSize: "1.85rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}>
            {formatCents(pendingTotal)}
          </p>
          <p className="font-serif italic mt-1" style={{ fontSize: "0.72rem", color: "hsl(var(--olivewood) / 0.8)" }}>
            clearing soon
          </p>
        </div>
      </div>

      {(() => {
        const instantAvailable = (stripeData.instant_available ?? []).reduce((s, b) => s + b.amount, 0);
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
              <div className="flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-primary" />
                <span className="text-ds-11 font-semibold text-foreground">Instant cash out</span>
                {!canUseInstantPayout && (
                  <span
                    className="text-[8.5px] font-bold uppercase tracking-wider px-1 py-0.5 rounded-full"
                    style={{
                      background: "hsl(var(--burnt-sienna) / 0.14)",
                      color: "hsl(var(--burnt-sienna))",
                      letterSpacing: "0.06em",
                    }}
                  >
                    Pro
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
              <Zap className="w-3.5 h-3.5" /> Cash out
            </Button>
          </div>
        );
      })()}

      {!stripeData.payouts_enabled && (
        <p className="mt-2 text-ds-11 text-destructive">
          Payouts not yet enabled — finish setup to start receiving funds.
        </p>
      )}
    </div>
  );
}
