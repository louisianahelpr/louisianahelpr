import type { ComponentProps } from "react";
import { CohortRetentionCard, FunnelCard } from "../AdminAnalyticsCards";
import { SectionLabel } from "./analyticsLazy";
import { SignupLeadsCard } from "./SignupLeadsCard";

type Stages = ComponentProps<typeof FunnelCard>["stages"];

/** Analytics' "Funnels & Retention" section: the two activation funnels, the
 *  monthly cohorts, and the sign-up leads (Q1587). */
export function FunnelsAndRetention({
  customerFunnel,
  helperFunnel,
  cohorts,
  monthLabel,
}: {
  customerFunnel: Stages;
  helperFunnel: Stages;
} & ComponentProps<typeof CohortRetentionCard>) {
  return (
    <>
      <SectionLabel>Funnels &amp; Retention</SectionLabel>
      <div className="grid sm:grid-cols-2 gap-4">
        <FunnelCard title="Poster activation" subtitle="Signup → revenue" stages={customerFunnel} />
        <FunnelCard title="Helpr supply" subtitle="Signup → first paid job" stages={helperFunnel} />
      </div>

      <CohortRetentionCard cohorts={cohorts} monthLabel={monthLabel} />

      <SignupLeadsCard />
    </>
  );
}
