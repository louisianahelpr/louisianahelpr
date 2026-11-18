import { useState } from "react";
import { AdminViewShell } from "./AdminViewShell";
import { DeclutterReviewCard } from "./settings/DeclutterReviewCard";
import { DeclutterProblemsCard } from "./settings/DeclutterProblemsCard";
import { MeetupSpotsCard } from "./settings/MeetupSpotsCard";
import { DeclutterShippingClaimsCard } from "./settings/DeclutterShippingClaimsCard";
import { DonationPartnersCard } from "./settings/DonationPartnersCard";
import { DeclutterFunnelCard } from "./settings/DeclutterFunnelCard";
import { DeclutterPreviewCard } from "./settings/DeclutterPreviewCard";

/**
 * Design audit area 10 #2 (11-18): the Declutter admin work (problems queue, shipping claims, meetup spots,
 * donation partners, the funnel) sat at the bottom of Settings, under every switch. It is a queue someone works
 * daily, so it has its own row under Queues (adminNavGroups "declutter", with a badge: open problems plus claims
 * due). The cards are moved here unchanged; only the switches stay in Settings.
 * Guard: src/test/adminDeclutterView.test.ts.
 */
export default function AdminDeclutter() {
  // One "Show test listings" switch for both Declutter review cards (audit 1028 part 2, D2-4).
  const [showTest, setShowTest] = useState(false);
  return (
    <AdminViewShell>
      <DeclutterReviewCard showTest={showTest} onShowTestChange={setShowTest} />
      <DeclutterProblemsCard includeTest={showTest} />
      <MeetupSpotsCard />
      <DeclutterShippingClaimsCard />
      <DonationPartnersCard />
      <DeclutterFunnelCard />
      <DeclutterPreviewCard />
    </AdminViewShell>
  );
}
