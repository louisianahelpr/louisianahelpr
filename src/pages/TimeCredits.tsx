import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Clock, Coins, ChevronRight, CheckCircle2, PiggyBank, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import PageHeader from "@/components/PageHeader";
import NotificationPanel from "@/components/NotificationPanel";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { formatShortDate } from "@/lib/format";

// Credit presets (minutes → $10/hr discount)
const PRESET_MINUTES = [60, 120, 180];

export default function TimeCredits() {
  usePageTitle("Time Credits — Helpr");
  const { user } = useCurrentUser();
  const navigate = useNavigate();

  // Balance via RPC — PGRST202-safe (returns 0 if function not yet deployed)
  const { data: balanceMinutes = 0 } = useQuery({
    queryKey: ["time-credit-balance", user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return 0;
      const { data, error } = await (supabase as any).rpc(
        "get_time_credit_balance",
        { p_user_id: user.id },
      );
      // PGRST202 = function not found (migration not deployed yet)
      if (error && (error.code === "PGRST202" || error.code === "42883")) {
        return 0;
      }
      if (error) throw error;
      return (data as number) ?? 0;
    },
  });

  // Transaction history — PGRST202-safe
  const {
    data: history = [],
    isError: historyError,
    refetch: refetchHistory,
  } = useQuery({
    queryKey: ["time-credit-history", user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await (supabase as any)
        .from("time_credits")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      // 42P01 = table not found, PGRST202 = function not found
      if (
        error &&
        (error.code === "42P01" ||
          error.code === "PGRST202" ||
          error.message?.includes("does not exist"))
      ) {
        return [];
      }
      if (error) throw error;
      return (data as any[]) ?? [];
    },
  });

  const balanceHours = Math.floor(balanceMinutes / 60);
  const balanceMins = balanceMinutes % 60;
  const dollarValue = ((balanceMinutes / 60) * 10).toFixed(2);

  return (
    <div className="min-h-screen pb-safe-nav" style={{ background: "hsl(var(--parchment))" }}>
      <PageHeader title="Time Credits" showBrand rightSlot={<NotificationPanel />} />

      <div className="max-w-lg mx-auto px-4 pt-4 space-y-6">
        {/* Balance card */}
        <div
          className="rounded-2xl p-6 text-white shadow-lg"
          style={{
            background:
              "linear-gradient(135deg, hsl(var(--bark)) 0%, hsl(var(--gold-warm)) 100%)",
          }}
        >
          <div className="flex items-center gap-2 mb-3 opacity-90">
            <Clock className="w-5 h-5" />
            <span className="font-medium text-sm uppercase tracking-wide">
              Your Balance
            </span>
          </div>
          <div className="text-4xl font-bold mb-1">
            {balanceHours}h{balanceMins > 0 ? ` ${balanceMins}m` : ""}
          </div>
          <div className="text-lg opacity-80">≈ ${dollarValue} in discounts</div>
          <p className="text-sm opacity-70 mt-2">
            Every completed job earns you 1 hour of credit.
          </p>
        </div>

        {/* How it works */}
        <div
          className="rounded-2xl p-5 space-y-3"
          style={{ background: "hsl(var(--cream))" }}
        >
          <h2
            className="font-semibold text-base"
            style={{ color: "hsl(var(--bark))" }}
          >
            How it works
          </h2>
          <ul className="space-y-2 text-sm" style={{ color: "hsl(var(--olivewood))" }}>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "hsl(var(--bark))" }} aria-hidden />
              <span>Complete any job as a helper to earn 60 minutes (1 credit).</span>
            </li>
            <li className="flex items-start gap-2">
              <PiggyBank className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "hsl(var(--bark))" }} aria-hidden />
              <span>
                Redeem credits as a $10/hr discount when you post your own job.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <RefreshCw className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "hsl(var(--bark))" }} aria-hidden />
              <span>Credits never expire — keep helping, keep saving.</span>
            </li>
          </ul>
        </div>

        {/* Redeem section */}
        {balanceMinutes >= 60 && (
          <div
            className="rounded-2xl p-5 space-y-3"
            style={{ background: "hsl(var(--cream))" }}
          >
            <h2
              className="font-semibold text-base"
              style={{ color: "hsl(var(--bark))" }}
            >
              Apply credits to a new job
            </h2>
            <p className="text-sm" style={{ color: "hsl(var(--olivewood))" }}>
              Choose how many credits to apply at checkout:
            </p>
            <div className="flex gap-2 flex-wrap">
              {PRESET_MINUTES.filter((m) => m <= balanceMinutes).map((mins) => (
                <Button
                  key={mins}
                  variant="outline"
                  className="flex-1"
                  style={{
                    borderColor: "hsl(var(--bark) / 0.4)",
                    color: "hsl(var(--bark))",
                  }}
                  onClick={() => navigate(`/post-job?credits=${mins}`)}
                >
                  <Coins className="w-4 h-4 mr-1" />
                  {mins / 60}h off (−${((mins / 60) * 10).toFixed(0)})
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* CTA: post a job */}
        <Button
          className="w-full"
          style={{
            background: "hsl(var(--bark) / 0.10)",
            color: "hsl(var(--bark))",
            border: "1px solid hsl(var(--bark) / 0.30)",
          }}
          onClick={() => navigate("/post-job")}
        >
          Post a job
          <ChevronRight className="w-4 h-4 ml-1" />
        </Button>

        {/* Transaction history — surface a recoverable error rather than
            silently hiding the section when the fetch genuinely fails. */}
        {historyError && (
          <ErrorState
            variant="inline"
            title="Couldn't load your history."
            body="Your balance is still safe. Tap Try again to reload your credit history."
            onRetry={() => refetchHistory()}
          />
        )}

        {/* Transaction history */}
        {!historyError && history.length > 0 && (
          <div className="space-y-2 pb-6">
            <h2
              className="font-semibold text-base"
              style={{ color: "hsl(var(--bark))" }}
            >
              History
            </h2>
            {history.map((tx: any) => {
              const isEarn = tx.amount_minutes > 0;
              const hrs = Math.abs(Math.floor(tx.amount_minutes / 60));
              const mins = Math.abs(tx.amount_minutes % 60);
              return (
                <div
                  key={tx.id}
                  className="flex items-center justify-between rounded-xl px-4 py-3"
                  style={{ background: "hsl(var(--cream))" }}
                >
                  <div>
                    <p
                      className="text-sm font-medium"
                      style={{ color: "hsl(var(--bark))" }}
                    >
                      {tx.description ?? (isEarn ? "Job completed" : "Credit redeemed")}
                    </p>
                    <p
                      className="text-xs"
                      style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                    >
                      {formatShortDate(tx.created_at)}
                    </p>
                  </div>
                  <span
                    className="font-semibold text-sm"
                    style={{
                      color: isEarn
                        ? "hsl(155 50% 35%)"
                        : "hsl(var(--burnt-sienna))",
                    }}
                  >
                    {isEarn ? "+" : "−"}
                    {hrs}h{mins > 0 ? `${mins}m` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
}
