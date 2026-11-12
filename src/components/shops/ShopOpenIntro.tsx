/**
 * The first lines of /shops/mine before a shop exists (shops audit 11-08 #9): everything the owner meets before the
 * first sale, said before they fill in the form. Opening is free; the ID check comes once, before the first item goes
 * live (trg_shop_items_identity_before_list, only while the identity_check switch is on for them); the one-time
 * account setup fee comes out of the first payout (shop_payout_take_setup_fee, the platform's live amount).
 */
import { useIdentityCheckStatus } from "@/hooks/useIdentityCheckOn";
import { useOnboardingFeeCents } from "@/hooks/useOnboardingFee";
import { useCurrentUser } from "@/hooks/useCurrentUser";

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

export default function ShopOpenIntro() {
  const idCheck = useIdentityCheckStatus();
  const feeCents = useOnboardingFeeCents();
  const { profile } = useCurrentUser();
  const feeOwed = profile?.onboarding_fee_paid !== true;
  return (
    <p className="text-ds-13 text-muted-foreground">
      Opening a shop is free, and it is also your business profile. You need to be 18 or older.
      {idCheck.on ? " Before your first item goes live you verify your ID once (about 2 minutes)." : ""}
      {" "}Payouts come later, when you make your first sale
      {feeOwed
        ? `, and a one-time ${feeCents ? `${dollars(feeCents)} ` : ""}account setup fee comes out of your first payout.`
        : "."}
    </p>
  );
}
