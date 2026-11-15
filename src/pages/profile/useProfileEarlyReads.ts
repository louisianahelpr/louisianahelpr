import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { publicPageQuery } from "@/components/profile/YourPageLink";
import { fetchSmsConsent, smsConsentQueryKey } from "@/lib/smsConsentQuery";
import type { Tab } from "./types";

/**
 * Reads /profile starts before the card that shows them mounts, so the card draws from the cache.
 *
 * - /profile LCP (lead 11-15): the Your page card's line is this page's largest paint, and the card mounts only once
 *   the landing's skeleton lifts (the section switches, ~1 s after the profile row on Slow 4G). Ask whether the page
 *   opens as soon as the profile names the handle, with the card's own query options, as Home does.
 *   Guard: src/test/homeYourPageNotHeld.test.ts.
 * - Q2706 (11-05): Notifications' largest paint waited on the text-alerts consent read, which the card only started
 *   after the tab's chunks loaded. Start it as soon as the member and the tab are known; the card mounts with its
 *   answer (src/lib/smsConsentQuery.ts, src/test/notificationsConsentReadStartsEarly.test.ts).
 */
export function useProfileEarlyReads(myHandle: string | null, tab: Tab, userId: string | undefined) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (myHandle) void queryClient.prefetchQuery(publicPageQuery(myHandle));
  }, [myHandle, queryClient]);
  useEffect(() => {
    if (tab !== "notifications" || !userId) return;
    void queryClient.prefetchQuery({ queryKey: smsConsentQueryKey(userId), queryFn: fetchSmsConsent });
  }, [tab, userId, queryClient]);
}
