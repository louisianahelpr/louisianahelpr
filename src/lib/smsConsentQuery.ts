/**
 * The text-alerts consent read (get_my_sms_consent), shared by SmsAlertsCard and Profile's early start of it.
 *
 * Q2706 (11-05, live lab on prod, helper, 375, Fast 4G + 4x): on You > Notifications the largest paint is the
 * text-alerts consent label, which waited for this read, and the read only started once the tab's lazy chunks had
 * loaded and the card mounted (sent at ~1.87 s, answered ~2.07 s: LCP 2044-2096 ms, over the 2 s rule; the card
 * growing from its loading box was the tab's 0.153 CLS). Profile now starts it as soon as it knows the member and
 * the tab, so the card mounts with its answer. One key and one queryFn, so the two can never read differently.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { parseSmsConsent, type SmsConsent } from "@/lib/smsConsent";

export const SMS_CONSENT_QUERY_KEY = ["sms-consent"] as const;

export const smsConsentQueryKey = (userId: string | undefined) => [...SMS_CONSENT_QUERY_KEY, userId] as const;

export async function fetchSmsConsent(): Promise<SmsConsent> {
  return parseSmsConsent(unwrap(await supabase.rpc("get_my_sms_consent")));
}
