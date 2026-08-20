import { useState } from "react";
import { ShieldCheck, Clock, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { hapticError } from "@/lib/haptics";
import { report } from "@/lib/errorLogger";
import { functionErrorMessage } from "@/lib/supabaseResult";
import { BGC_FEE_CENTS, formatFeeUsd } from "@/lib/productPrices";

const BGC_PRICE = formatFeeUsd(BGC_FEE_CENTS);

/**
 * The purchase is OFF while the screening provider has no accounts.
 *
 * `create-bgc-payment` charges live money, but `verification-webhook` 401s
 * without CHECKR_WEBHOOK_SECRET / CERTIFICIAL_WEBHOOK_SECRET — so a helper can
 * pay for a check whose RESULT can never be recorded. They would sit at
 * "in progress" indefinitely, having been charged, with no badge and no
 * refund path. Taking money for something that cannot complete is the one
 * thing this card must not do.
 *
 * Deliberately a one-line flag rather than a deletion: the backend, the price,
 * the badge and the status rendering all stay, so re-enabling is flipping this
 * to `true` once the provider accounts exist. The matching server-side guard
 * is in `supabase/functions/create-bgc-payment/index.ts` — this constant is
 * not the enforcement point, since the edge function is callable directly.
 *
 * NOT changed here, and worth a look separately: a helper already sitting at
 * `pending` from before this was switched off is still shown "in progress",
 * which the broken webhook means may never resolve. Deciding what to tell them
 * (and whether to refund) is an owner call, not a UI change.
 */
const BGC_PURCHASE_ENABLED = false;

/**
 * Own-profile card letting a helper pay for their own background check to
 * earn the public "Background-Checked" badge. Renders different states by
 * profiles.background_check_status:
 *   - verified → confirmation
 *   - pending  → in-progress
 *   - none/failed → purchase CTA (calls create-bgc-payment → Stripe Checkout)
 */
export function BackgroundCheckCard({ status }: { status: string }) {
  const [loading, setLoading] = useState(false);

  const startCheck = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-bgc-payment", {
        body: {},
      });
      if (error) {
        // FunctionsHttpError hides the real reason in the response body.
        toast.error(
          await functionErrorMessage(error, "Couldn't start your background check. Please try again."),
        );
        hapticError();
        return;
      }
      if (data?.error) {
        toast.error(data.error);
        hapticError();
        return;
      }
      if (!data?.url) {
        toast.error("Couldn't start your background check. Please try again.");
        hapticError();
        return;
      }
      window.location.href = data.url;
    } catch (err) {
      report(err, { tags: { area: "background_check.start" } });
      toast.error("Couldn't start your background check — try again?");
      hapticError();
    } finally {
      setLoading(false);
    }
  };

  if (status === "verified") {
    return (
      <div
        className="rounded-2xl liquid-glass p-4 flex items-center gap-3"
        style={{ border: "0.5px solid hsl(var(--sage) / 0.4)" }}
      >
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
          style={{ background: "hsl(var(--sage) / 0.18)" }}
        >
          <ShieldCheck className="w-5 h-5" style={{ color: "hsl(var(--success-ink))" }} />
        </div>
        <div>
          <p className="font-semibold text-ds-14" style={{ color: "hsl(var(--ink-deep))" }}>
            You're background-checked
          </p>
          <p className="text-ds-12 text-muted-foreground">
            Your Background-Checked badge is live on your profile.
          </p>
        </div>
      </div>
    );
  }

  if (status === "pending") {
    return (
      <div
        className="rounded-2xl liquid-glass p-4 flex items-center gap-3"
        style={{ border: "0.5px solid hsl(var(--amber-tint) / 0.35)" }}
      >
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
          style={{ background: "hsl(var(--amber-tint) / 0.16)" }}
        >
          <Clock className="w-5 h-5" style={{ color: "hsl(var(--amber-tint))" }} />
        </div>
        <div>
          <p className="font-semibold text-ds-14" style={{ color: "hsl(var(--ink-deep))" }}>
            Background check in progress
          </p>
          <p className="text-ds-12 text-muted-foreground">
            We'll add your badge as soon as it clears — usually within a few days.
          </p>
        </div>
      </div>
    );
  }

  // none / failed → offer the purchase, unless it is switched off. When off
  // the card renders NOTHING rather than a "coming soon" tile: a helper who
  // has never had a check does not need to be told about a thing they cannot
  // buy, and a disabled CTA on the profile is just a dead control taking up
  // the same space.
  if (!BGC_PURCHASE_ENABLED) return null;

  return (
    <div className="rounded-2xl liquid-glass p-5 space-y-3">
      <div className="flex items-start gap-3">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
          style={{ background: "hsl(var(--bark) / 0.12)" }}
        >
          <ShieldCheck className="w-5 h-5" style={{ color: "hsl(var(--bark))" }} />
        </div>
        <div>
          <p className="font-semibold text-ds-15" style={{ color: "hsl(var(--ink-deep))" }}>
            Get background-checked
          </p>
          <p className="text-ds-12 text-muted-foreground leading-snug mt-0.5">
            Stand out to posters with a verified Background-Checked badge on your
            profile. One-time screening, paid by you — {BGC_PRICE}.
          </p>
        </div>
      </div>
      {status === "failed" && (
        <p className="text-ds-11" style={{ color: "hsl(var(--burnt-sienna))" }}>
          Your last check didn't clear. You can try again below.
        </p>
      )}
      <Button
        variant="primary"
        size="lg"
        className="w-full"
        disabled={loading}
        onClick={startCheck}
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" /> Starting…
          </>
        ) : (
          <>Get background-checked · {BGC_PRICE}</>
        )}
      </Button>
    </div>
  );
}

export default BackgroundCheckCard;
