import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthReady } from "@/hooks/useAuthReady";
import { useFeature } from "@/hooks/useFeature";
import { unwrap } from "@/lib/supabaseResult";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { report } from "@/lib/errorLogger";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHero, DialogSecondaryAction } from "@/components/ui/dialog";
import SmsAlertsCard from "./SmsAlertsCard";

/** The two moments the prompt is offered at (the server decides whether it is the member's first). */
export type SmsPromptMoment = "first_job" | "first_hire";

export const SMS_PHONE_PROMPT_TITLE = "Add your phone so you don't miss updates";

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
 */
export function SmsPhonePrompt({ moment }: { moment: SmsPromptMoment }) {
  const enabled = useFeature("sms_alerts");
  const { user } = useAuthReady();
  const [closed, setClosed] = useState(false);
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
      // Any other failure: no prompt (unwrap throws, the query errors).
      return unwrap(res) === true;
    },
  });
  const close = () => {
    setClosed(true);
    void supabase.rpc("dismiss_sms_phone_prompt").then(({ data, error }) => {
      // A zero-row answer is not a write: no timestamp back means it was not stored.
      if (error || !data) {
        report(error ?? new Error("dismiss_sms_phone_prompt stored nothing"), {
          tags: { area: "sms_phone_prompt", moment },
          context: { words: error ? rpcErrorMessage("dismiss_sms_phone_prompt", error) : null },
        });
      }
    });
  };
  if (!enabled || closed || due.data !== true) return null;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent onOpenAutoFocus={(e) => e.preventDefault()} data-sms-phone-prompt={moment}>
        <DialogHero title={SMS_PHONE_PROMPT_TITLE} />
        <DialogBody>
          <p>We'll text you when something on your job needs you and you haven't seen it in the app.</p>
          <SmsAlertsCard />
        </DialogBody>
        <DialogFooter>
          <DialogSecondaryAction onClick={close}>Not now</DialogSecondaryAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
