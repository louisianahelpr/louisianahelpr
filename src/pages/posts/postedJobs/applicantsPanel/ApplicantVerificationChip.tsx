import { ShieldAlert } from "lucide-react";
import {
  ID_VERIFIED_LABEL,
  ID_VERIFIED_PILL_STYLE,
  IdVerifiedShield,
  PAYOUTS_SET_UP_LABEL,
  PAYOUTS_SET_UP_PILL_STYLE,
  PayoutsSetUpIcon,
} from "@/components/profile/IdVerifiedPill";

/**
 * The applicant's two Stripe facts, each its own badge (owner, 2026-10-21):
 *   - "ID verified": Stripe Identity's photo ID + selfie (is_id_verified,
 *     idv_status = 'verified' only);
 *   - "Payouts set up": Stripe Connect payout setup (is_payout_ready).
 * Payout setup never draws the ID badge. Without payouts the chip says so as a
 * fact about Stripe, not a judgement of the person: a Helpr who simply hasn't
 * finished setup is not untrustworthy.
 */
export function ApplicantVerificationChip({
  idVerified,
  payoutReady,
}: {
  idVerified: boolean;
  payoutReady: boolean;
}) {
  const pill = "inline-flex items-center gap-1 shrink-0 rounded-full px-2 py-0.5 text-ds-10 font-sans font-semibold";
  return (
    <>
      {idVerified && (
        <span className={pill} style={ID_VERIFIED_PILL_STYLE} data-applicant-badge="id">
          <IdVerifiedShield className="w-3 h-3" />{ID_VERIFIED_LABEL}
        </span>
      )}
      {payoutReady ? (
        <span className={pill} style={PAYOUTS_SET_UP_PILL_STYLE} data-applicant-badge="payouts">
          <PayoutsSetUpIcon className="w-3 h-3" />{PAYOUTS_SET_UP_LABEL}
        </span>
      ) : (
        <span
          className={pill}
          style={{ background: "hsl(var(--amber-tint) / 0.16)", color: "hsl(var(--amber-ink))" }}
          title="This Helpr has not set up a payout account yet"
          data-applicant-badge="no-payouts"
        >
          <ShieldAlert className="w-3 h-3" strokeWidth={2} aria-hidden="true" />
          No payout account
        </span>
      )}
    </>
  );
}
