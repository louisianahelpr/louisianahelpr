import { Loader2, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { holdsPaidPlan, mayStillBeBilled } from "@/lib/subscriptionTiers";

type BillingFields = Parameters<typeof mayStillBeBilled>[0];

/**
 * Lead 2026-10-21: anyone who is, or may still be, billed can always manage or
 * cancel. A member whose plan has ended on our side (expired, or a renewal
 * webhook is late) no longer gets the active card's Manage button, so this
 * card carries the same billing-portal door while mayStillBeBilled holds.
 */
export function MembershipStillBilled({ profile, onManage, loading }: { profile: BillingFields; onManage: () => void; loading: boolean }) {
  if (!profile || holdsPaidPlan(profile.subscription_tier, profile.subscription_expires_at) || !mayStillBeBilled(profile)) return null;
  return (
    <div className="liquid-glass rounded-2xl p-card space-y-3" data-testid="membership-still-billed">
      <p className="text-ds-14 text-foreground">
        {/* No tier but a kept subscription link = the webhook saw past_due / unpaid. */}
        {!profile.subscription_tier && profile.stripe_subscription_id
          ? "Your last membership payment didn't go through. Update your card or cancel here."
          : "Your plan has ended. If you still see charges, you can manage or cancel billing here."}
      </p>
      <Button variant="outline" size="sm" onClick={onManage} disabled={loading}>
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Crown className="w-3.5 h-3.5" aria-hidden />}
        Manage billing
      </Button>
    </div>
  );
}
