/**
 * Homes' answer to identity_not_verified (owner 2026-10-19): the refusal's own
 * words, a "Verify your ID" pill (a paid Stripe Identity check, photo ID +
 * selfie, at its cost: supabase/functions/_shared/idvFee.ts) and the other way
 * through, payout setup (Stripe Connect's own ID check counts too).
 *
 * `paid`: back from Checkout (/rentals?idv=paid). The payment may still be
 * settling, so the pill asks the server; it never assumes the charge went through.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { isNativePlatform } from "@/lib/nativeInit";
import { userFacingError } from "@/lib/userFacingError";
import { payForIdCheck, startIdCheck, type IdCheckStep } from "@/lib/rentals/idCheck";
import { RENTALS_ERROR_COPY } from "@/lib/rentals/errorCopy";

export function VerifyIdNotice({ paid, onChange }: { paid: boolean; onChange: () => void }) {
  const [busy, setBusy] = useState(false);

  const run = async (first: "checkout" | "start") => {
    setBusy(true);
    try {
      let step: IdCheckStep = first === "checkout" ? await payForIdCheck() : await startIdCheck();
      // One hop each way at most: a paid check waiting means start it; no paid check means pay.
      if (step.kind === "paid") step = await startIdCheck();
      // No usable paid check (never paid, or the last one was used up): pay for one.
      if (step.kind === "needs_fee") step = await payForIdCheck();
      if (step.kind === "open") {
        await openExternalUrl(step.url, () => {
          setBusy(false);
          onChange();
        });
        // Web: the page is leaving, so the pill stays busy. App: the sheet is up over us.
        if (isNativePlatform) setBusy(false);
        return;
      }
      if (step.kind === "verified") {
        toast.success("Your ID is verified.");
        onChange();
      } else if (step.kind === "processing") {
        toast.success("Stripe is checking your ID. This usually takes a few minutes.");
      } else {
        toast.error("Your payment hasn't come through yet. Wait a minute and try again.");
      }
      setBusy(false);
    } catch (e) {
      toast.error(userFacingError(e, "Couldn't open the ID check. Try again in a moment."));
      setBusy(false);
    }
  };

  return (
    <div role="status" className="rounded-xl border border-border bg-muted p-3 text-sm space-y-2">
      <p>{paid ? "Payment received. Start your ID check: photo ID + selfie, about two minutes." : RENTALS_ERROR_COPY.identity_not_verified}</p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-grad-primary rounded-full px-5 py-2.5 text-sm font-semibold"
          disabled={busy}
          onClick={() => void run(paid ? "start" : "checkout")}
        >
          {busy ? "Opening…" : paid ? "Start your ID check" : "Verify your ID"}
        </button>
        {!paid && (
          <Link to="/profile?tab=earnings" className="text-sm font-medium underline underline-offset-2">
            Set up payouts
          </Link>
        )}
      </div>
    </div>
  );
}
