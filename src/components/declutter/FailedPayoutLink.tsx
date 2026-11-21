import { Link } from "react-router-dom";
import { usePayoutSetupBlock } from "@/hooks/usePayoutSetupPaused";
import { t, useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enDeclPayout";
import { payoutLineWaitsOnSetup } from "./declutterPayoutWords";

/**
 * NIGHT-SELL-soldstates-4: a failed seller payout links to the payout settings. While payout setup is paused for
 * everyone (Stripe, owner 2026-10-23) that screen offers nothing to fix, so the link waits (the payout prompt above
 * the sales shows the paused notice), as SellerPayoutPrompt does.
 */
export function FailedPayoutLink() {
  const paused = usePayoutSetupBlock() === "paused";
  useLanguage();
  if (paused) return null;
  return <>{" "}<Link to="/profile?tab=payment" className="underline font-semibold">{t("dpo.check")}</Link></>;
}

/**
 * Area 06 H2 (11-18): "You get $40 once you set up payouts in Settings." had no way there. The words link to the payout
 * settings, held back while setup is paused for everyone (the same rule as the failed-payout link above).
 * Audit 11-20 night Low 6: whether the line waits on setup is asked of the module that builds the line
 * (payoutLineWaitsOnSetup reads the same dictionary templates), never an English pattern, so it links in Spanish too.
 */
function PayoutSetupLink({ line }: { line: string }) {
  const paused = usePayoutSetupBlock() === "paused";
  useLanguage();
  if (paused || !payoutLineWaitsOnSetup(line)) return null;
  return <>{" "}<Link to="/profile?tab=payment" className="underline font-semibold" data-payout-setup-link="">{t("dpo.setUp")}</Link></>;
}

/** The seller's payout line, with the payout settings link when the line waits on setup. */
export function PayoutLineText({ line }: { line: string }) {
  return <>{line}<PayoutSetupLink line={line} /></>;
}
