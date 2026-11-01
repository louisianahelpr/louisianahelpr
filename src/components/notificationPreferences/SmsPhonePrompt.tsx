import { lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthReady } from "@/hooks/useAuthReady";
import { useFeature } from "@/hooks/useFeature";
import { unwrap } from "@/lib/supabaseResult";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { loadModule } from "@/lib/loadModule";
// B87: the refusal words load only on a refusal, and the dialog (Radix, the opt-in card) only once it is due.
const lifecycleErrors = () => loadModule(() => import("@/lib/lifecycleErrors"));
const SmsPhonePromptDialog = lazy(() => import("./SmsPhonePromptDialog"));

/**
 * The moments the prompt is offered at; the server decides whether it is due. "has_phone" (SMS-OPTIN, owner
 * 2026-10-29, migration 20261030132841): on Home, for a member whose profile already has a phone and whose texts
 * are off (53 such members on prod, 0 with texts on, 2026-10-30).
 */
export type SmsPromptMoment = "first_job" | "first_hire" | "has_phone";

export const SMS_PHONE_PROMPT_TITLE = "Add your phone so you don't miss updates";
/** How long "You're all set" shows before the prompt closes itself (owner, 2026-10-31: "about 2 s"). */
export const SMS_PROMPT_ALL_SET_MS = 2000;
/** They already gave a phone: ask them to turn texts on, not to add one. */
export const SMS_TEXTS_PROMPT_TITLE = "Turn on texts so you don't miss updates";

/**
 * The one-time "Add your phone so you don't miss updates" prompt (owner-approved 2026-10-27), with the existing
 * text-alert opt-in inside it: SmsAlertsCard itself, so the consent sentence, its version (sms-v2, stamped by
 * the server) and the double opt-in are the same ones Settings uses, never a copy.
 *
 * Shown when a member posts their FIRST job (PaymentSuccess) and when a Helpr is FIRST hired (Activity), only
 * while text alerts are open to them (switch sms_alerts) and the server says it is due: sms_phone_prompt_due
 * (20261027183058) answers false once it was dismissed on the ACCOUNT, once a phone is confirmed or a
 * confirmation text is waiting, and for anything but the member's first post or hire. Never on sign-up (no
 * session there). Any close, "Not now" or after turning texts on, dismisses it for good
 * (dismiss_sms_phone_prompt); a failed dismiss is logged, and the worst case is the prompt once more.
 *
 * DONE MEANS GONE (owner, 2026-10-31, LEAD-PHONE-PROMPT-DONE): she confirmed her phone inside the prompt, came
 * back, and the SAME prompt was open, reading "Text alerts: On" with only "Turn off text alerts" and "Not now".
 * The due answer is cached for the session (staleTime Infinity) and `closed` is per mount, so a remount showed it
 * again; and the card inside offered Settings' Turn off. Now: once texts are on, the card says "You're all set,
 * texts go to ..." (no Turn off), and the prompt closes itself after SMS_PROMPT_ALL_SET_MS; or, if texts were on
 * from the first read it closes at once. Every close dismisses on the account AND writes "not due" into every
 * cached due answer, so no remount in this session shows it again; the server answers false after that.
 */
export function SmsPhonePrompt({ moment }: { moment: SmsPromptMoment }) {
  const enabled = useFeature("sms_alerts");
  const { user } = useAuthReady();
  const due = useQuery({
    queryKey: ["sms-phone-prompt", moment, user?.id],
    enabled: enabled && !!user,
    staleTime: Infinity,
    // Account-scoped and one-time: never restored from the persisted cache.
    meta: { persist: false },
    queryFn: async (): Promise<boolean> => {
      const res = await supabase.rpc("sms_phone_prompt_due", { p_moment: moment });
      // Not deployed yet (the web build can reach prod before db-deploy): never prompt.
      if (res.error && isMissingRpcNamed(res.error, "sms_phone_prompt_due")) return false;
      // Any other failure: no prompt; unwrap throws it, in words the error log can read.
      if (res.error) {
        const copy = await lifecycleErrors();
        res.error.message = copy?.rpcErrorMessage("sms_phone_prompt_due", res.error) ?? res.error.message;
      }
      return unwrap(res) === true;
    },
  });
  if (!enabled || due.data !== true) return null;
  return <Suspense fallback={null}><SmsPhonePromptDialog moment={moment} /></Suspense>;
}
