// @mutate src/pages/profile/Profile.tsx |     void queryClient.prefetchQuery({ queryKey: smsConsentQueryKey(userId), queryFn: fetchSmsConsent }); |     void 0;
// @mutate src/pages/profile/Profile.tsx |     if (tab !== "notifications" \|\| !userId) return; |     if (tab !== "security" \|\| !userId) return;
// @mutate src/components/notificationPreferences/SmsAlertsCard.tsx |     queryKey: smsConsentQueryKey(user?.id), |     queryKey: ["sms-consent-card", user?.id],
/**
 * Q2706 (11-05, live lab on prod, helper, 375, Fast 4G + 4x, ~/.lh-shots/b3-errlogs/live-0150.json): You >
 * Notifications' largest paint (the text-alerts consent label) waited on get_my_sms_consent, which the card only
 * sent at ~1.87 s, after the tab's lazy chunks: LCP 2044-2096 ms, over the 2 s rule. Profile starts the same read
 * (same key, same queryFn, src/lib/smsConsentQuery.ts) as soon as the member and the Notifications tab are known.
 * Source reads: the start must be keyed on the notifications tab and share the card's key, or the card reads twice.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const profile = blankComments(readFileSync("src/pages/profile/Profile.tsx", "utf8"));
const card = blankComments(readFileSync("src/components/notificationPreferences/SmsAlertsCard.tsx", "utf8"));
const shared = blankComments(readFileSync("src/lib/smsConsentQuery.ts", "utf8"));

describe("Notifications starts the text-alerts read before its card mounts", () => {
  it("Profile prefetches it on the notifications tab", () => {
    const at = profile.indexOf("prefetchQuery({ queryKey: smsConsentQueryKey(userId), queryFn: fetchSmsConsent })");
    expect(at).toBeGreaterThan(0);
    expect(profile.slice(Math.max(0, at - 160), at)).toContain('if (tab !== "notifications" || !userId) return;');
  });

  it("the card reads the same key with the same function", () => {
    expect(card).toContain("queryKey: smsConsentQueryKey(user?.id),");
    expect(card).toContain("queryFn: fetchSmsConsent,");
    expect(card).not.toContain('supabase.rpc("get_my_sms_consent")');
    expect(shared).toContain('supabase.rpc("get_my_sms_consent")');
  });
});
