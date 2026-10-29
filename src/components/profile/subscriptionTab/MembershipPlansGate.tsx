import type { ReactNode } from "react";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { ProfileTabBody } from "@/components/profile/ProfileTabBody";
import { ProfileTabBodyReserve } from "@/components/profile/ProfileTabFallback";
import { MembershipsUnavailable } from "@/components/profile/subscriptionTab/MembershipFootnotes";
import { useMembershipsStatus } from "@/hooks/useMembershipsOn";
import { mayStillBeBilled } from "@/lib/subscriptionTiers";

type BillingFields = Parameters<typeof mayStillBeBilled>[0];

/**
 * Which Membership view a member gets (A3-C14, app audit 2026-10-29).
 *
 * /profile?tab=subscription showed the full paid price table (and the Free
 * tier's "20 min after posting" line, false while memberships are off: no one
 * waits) to members for whom the `memberships` switch is off; only Upgrade then
 * said "Memberships aren't available right now". While the switch is off the
 * plans are not shown at all, except to someone who holds a plan or may still
 * be billed (mayStillBeBilled): they keep the full tab, whose Manage billing
 * door the lead requires (2026-10-21). "loading" holds a skeleton so the table
 * never flashes before the answer is in.
 */
export function membershipPlansView(
  status: { on: boolean; settled: boolean },
  profile: BillingFields,
): "plans" | "closed" | "loading" {
  if (status.on || mayStillBeBilled(profile)) return "plans";
  return status.settled ? "closed" : "loading";
}

export function MembershipPlansGate({ profile, onBack, children }: { profile: BillingFields; onBack: () => void; children: ReactNode }) {
  const view = membershipPlansView(useMembershipsStatus(), profile);
  if (view === "closed") return <MembershipsUnavailable onBack={onBack} />;
  if (view === "loading") {
    return (
      <ProfileTabBody>
        <ProfileTabHeader title="Membership" onBack={onBack} />
        <ProfileTabBodyReserve tab="subscription" />
      </ProfileTabBody>
    );
  }
  return <>{children}</>;
}
