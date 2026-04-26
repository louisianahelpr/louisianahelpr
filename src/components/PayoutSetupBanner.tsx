import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Wallet, X } from "lucide-react";

interface Props {
  /** Pass the current user's role from profile. Banner only renders for helprs. */
  role: string | null | undefined;
  /** Optional userId — used so the dismissal is per-user (kept until they finish setup). */
  userId: string | null | undefined;
}

/**
 * Soft-nudge banner shown on the dashboard for helprs who have NOT yet connected
 * a Stripe payout account. Hidden once they finish setup. Dismissible per-session.
 *
 * Companion to PayoutSetupDialog (hard gate at apply time).
 */
export default function PayoutSetupBanner({ role, userId }: Props) {
  const navigate = useNavigate();
  const [needsSetup, setNeedsSetup] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const dismissKey = userId ? `payout-banner-dismissed:${userId}` : null;

  useEffect(() => {
    if (dismissKey && sessionStorage.getItem(dismissKey) === "1") {
      setDismissed(true);
    }
  }, [dismissKey]);

  useEffect(() => {
    let cancelled = false;
    if (role !== "helper") return;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("stripe-connect", {
          body: { action: "status" },
        });
        if (error || cancelled) return;
        const status = data as { connected?: boolean; details_submitted?: boolean };
        if (!status?.connected || !status?.details_submitted) {
          setNeedsSetup(true);
        }
      } catch {
        /* silent — banner just won't show */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [role, userId]);

  if (role !== "helper" || !needsSetup || dismissed) return null;

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 flex items-center gap-3">
      <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
        <Wallet className="w-4 h-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">Set up payouts to start earning</p>
        <p className="text-xs text-muted-foreground">
          You can browse jobs now, but you'll need a payout account before you can apply.
        </p>
      </div>
      <Button size="sm" onClick={() => navigate("/profile?tab=payment")}>
        Set up
      </Button>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          setDismissed(true);
          if (dismissKey) sessionStorage.setItem(dismissKey, "1");
        }}
        className="text-muted-foreground hover:text-foreground transition-colors p-1"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
