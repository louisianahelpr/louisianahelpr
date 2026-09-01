import { useState } from "react";
import { ShieldCheck, Clock, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { hapticError } from "@/lib/haptics";
import { report } from "@/lib/errorLogger";
import { functionErrorMessage } from "@/lib/supabaseResult";
import { BGC_FEE_CENTS, formatFeeUsd } from "@/lib/productPrices";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { isNativePlatform } from "@/lib/nativeInit";

const BGC_PRICE = formatFeeUsd(BGC_FEE_CENTS);

/**
 * Background-check PURCHASE is switched off — flip to `true` to re-enable.
 *
 * The buy path works and charges real money (`create-bgc-payment` → Stripe
 * Checkout, live keys), but the RESULT can never come back: the vendor callback
 * lands on `verification-webhook`, which picks `CHECKR_WEBHOOK_SECRET` /
 * `CERTIFICIAL_WEBHOOK_SECRET` (index.ts:67) and returns 401 when the secret is
 * absent (:75, :80). Verified against Supabase — NEITHER secret is set, because
 * the owner has no account with either vendor yet. So a helper could be charged
 * and left permanently `pending`, with no badge and nothing to refund against.
 *
 * Owner's decision (2026-08-19): "No accounts — disable the purchase", and
 * "for now" — hence a flag here rather than deleting the feature. Nothing in
 * the backend was removed; `create-bgc-payment` and the webhook are untouched
 * and will work the moment the vendor secrets exist.
 *
 * The `verified` and `pending` states below deliberately still render: anyone
 * already mid-check or already badged must keep seeing their real status.
 * Only the CTA that takes money is withdrawn.
 *
 * THIS FLAG IS NOT THE ENFORCEMENT POINT. An edge function is callable
 * directly with any signed-in token, so hiding a button stops nobody who has
 * already seen the endpoint. `create-bgc-payment` carries the matching guard
 * and returns 503 before any Stripe work; both must stay off together.
 *
 * TO RE-ENABLE: set the vendor secret(s) in Supabase, confirm a test callback
 * records a result, then set BOTH this and the flag in
 * supabase/functions/create-bgc-payment/index.ts to `true`.
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
function BackgroundCheckCard({ status }: { status: string }) {
  const [loading, setLoading] = useState(false);

  const startCheck = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-bgc-payment", {
        body: { native: isNativePlatform },
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
      await openExternalUrl(data.url);
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

  // none / failed → offer the purchase.
  //
  // Withdrawn while BGC_PURCHASE_ENABLED is false: rendering nothing is
  // deliberate over showing a disabled button or a "coming soon" card, because
  // a helper who never knew the feature existed is not missing anything, while
  // a greyed-out CTA invites "why can't I?" support tickets about a feature we
  // cannot currently deliver.
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
          <>Get Background-Checked · {BGC_PRICE}</>
        )}
      </Button>
    </div>
  );
}

export default BackgroundCheckCard;
