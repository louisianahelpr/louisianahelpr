/**
 * The first lines of /shops/mine before a shop exists (shops audit 11-08 #9): everything the owner meets before the
 * first sale, said before they fill in the form. Opening is free; there is no ID check for Shops (owner 2026-11-20,
 * 20261120203904); the one-time account setup fee comes out of the first payout (shop_payout_take_setup_fee, the
 * platform's live amount).
 */
import { useOnboardingFeeCents } from "@/hooks/useOnboardingFee";
import { useCurrentUser } from "@/hooks/useCurrentUser";

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

export default function ShopOpenIntro() {
  const feeCents = useOnboardingFeeCents();
  const { profile } = useCurrentUser();
  const feeOwed = profile?.onboarding_fee_paid !== true;
  return (
    <p className="text-ds-13 text-muted-foreground">
      Opening a shop is free, and it is also your business profile. You need to be 18 or older.
      {" "}Payouts come later, when you make your first sale
      {feeOwed
        ? `, and a one-time ${feeCents ? `${dollars(feeCents)} ` : ""}account setup fee comes out of your first payout.`
        : "."}
    </p>
  );
}
