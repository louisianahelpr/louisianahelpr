import type { ReactNode } from "react";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { OfflineEmptyState } from "@/components/ui/OfflineEmptyState";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useFeedPhase } from "@/hooks/useFeedPhase";
import { TAB_TITLES, type Tab } from "@/pages/profile/types";

/**
 * Profile's boot placeholder, unless the profile can never arrive (Q571).
 *
 * Offline with nothing cached, useCurrentUser's query is PAUSED and its
 * `isLoading` stays true for as long as the connection is down, so Profile's
 * skeleton held forever and the tabs' own offline cards never mounted
 * (measured on prod at 375, +10 s: /profile and /profile?tab=pets on their
 * skeletons). Same rule as every feed: offline with nothing to show says so.
 * A tab keeps its real header (and working back); the landing has no header
 * of its own, so the card gets the gap a title row would have given it.
 */
export function ProfileOfflineGate({ tab, onBack, children }: { tab: Tab; onBack: () => void; children: ReactNode }) {
  const { profileQuery, refresh } = useCurrentUser();
  const phase = useFeedPhase(profileQuery ?? { status: "pending", fetchStatus: "idle" });
  if (phase !== "offline-empty") return <>{children}</>;
  return (
    <>
      {tab !== "landing" ? <ProfileTabHeader title={TAB_TITLES[tab]} onBack={onBack} /> : <div className="h-4" aria-hidden="true" />}
      <OfflineEmptyState
        body="Your profile will load here as soon as you're back online."
        onRetry={() => { void refresh(); }}
      />
    </>
  );
}
