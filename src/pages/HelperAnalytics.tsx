/**
 * HelperAnalytics — /analytics
 *
 * Document-scroll page wrapper around <HelperAnalyticsBody />. The dashboard
 * itself lives in helperAnalytics/HelperAnalyticsBody.tsx because the Profile
 * "Earnings & payouts" tab renders the same content as one of its sections
 * (owner request 2026-08-19: earnings, analytics and payout setup are ONE
 * screen). This route survives for deep links and for anyone who bookmarked
 * it; it is no longer linked from the Profile menu.
 */

import { useNavigate } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";
import PageHeader from "@/components/PageHeader";
import { HelperAnalyticsBody } from "./helperAnalytics/HelperAnalyticsBody";

const HelperAnalytics = () => {
  usePageTitle("Earnings & Analytics — Helpr");
  const navigate = useNavigate();

  return (
    // Canonical Profile sub-screen ladder, shared verbatim with the Profile
    // tab bodies (Profile.tsx) and PageHeader's `default` width.
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      <PageHeader
        title="Earnings & Analytics"
        onBack={() => navigate("/profile?tab=earnings")}
      />

      <div className="max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] mx-auto px-5 lg:px-8 xl:px-12 pt-4 pb-8">
        <HelperAnalyticsBody />
      </div>
    </div>
  );
};

export default HelperAnalytics;
