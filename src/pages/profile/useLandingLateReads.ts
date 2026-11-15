import { useQuery } from "@tanstack/react-query";
import { fetchPublicProfile } from "@/lib/profileLink/api";
import { useSectionsOpen } from "@/components/landing/useSectionsOpen";

/**
 * F260a (/profile CLS 0.1518 at 375, 0.1224 at 1440: prod-audit 43650083979, 11-14). Two reads the You landing draws
 * from answered AFTER its first paint, and each moved everything under it (cwv-lab on a local build against prod,
 * the poster account, ~/.lh-shots/b2-perf-1114/local-before-profile-h.json):
 *
 *  - the Your page card (YourPageLink) mounted only once rpc_ensure_my_handle and then public_profile_by_handle had
 *    answered: the card pushed Your activity and the menu down 109 px (0.0836), and for a page that does not open the
 *    card then turned into the one-line "Your page is hidden" note (0.0414), the screen's largest paint at 6.7 s;
 *  - the "Coming soon" marks on preview sections (features_open_to_everyone) grew those tiles 26 px (0.0153).
 *
 * The landing already holds its skeleton for the section switches (useArrivalGate, at most ARRIVAL_CAP_MS); these two
 * answers join that wait. The handle comes from the profile row the page already has, so the "does my page open?"
 * read starts with the page (same query key as YourPageLink and the /u page: the card draws from the cache), and the
 * open-to-everyone read is asked only when a preview mark is possible (Shops or Homes on for this viewer), exactly as
 * useSectionTabs asks it. A failed read counts as settled: the card's own rule keeps it on a failure.
 * Guard: src/test/profileLandingWaitsForLateReads.test.tsx.
 */
export function useLandingLateReadsSettled(handle: string | null | undefined, previewPossible: boolean): boolean {
  const page = useQuery({
    queryKey: ["public-profile", handle ?? ""],
    queryFn: () => fetchPublicProfile(handle as string),
    staleTime: 10 * 60_000,
    enabled: !!handle,
  });
  const open = useSectionsOpen(previewPossible);
  const pageSettled = !handle || !page.isPending;
  const openSettled = !previewPossible || open.settled;
  return pageSettled && openSettled;
}
