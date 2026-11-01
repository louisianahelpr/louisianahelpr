import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHero, DialogSecondaryAction } from "@/components/ui/dialog";
import SmsAlertsCard from "./SmsAlertsCard";
import { SMS_PHONE_PROMPT_TITLE, SMS_PROMPT_ALL_SET_MS, SMS_TEXTS_PROMPT_TITLE, type SmsPromptMoment } from "./SmsPhonePrompt";

/**
 * The phone prompt's dialog (see SmsPhonePrompt.tsx for when it shows and why every close dismisses). Its own
 * module (B87, 11-01): the dialog, the opt-in card and the refusal words load only once the server says the prompt
 * is due. Lazily from Home, the whole prompt made /home fetch signed-in-pages, signed-in-deep and Radix (~150 KB gz)
 * beside the dock for members it never shows to. src/test/smsPromptLoadsWhenDue.test.ts.
 */
export default function SmsPhonePromptDialog({ moment }: { moment: SmsPromptMoment }) {
  const [closed, setClosed] = useState(false);
  const [allSet, setAllSet] = useState(false);
  const queryClient = useQueryClient();
  const close = useCallback(() => {
    setClosed(true);
    // Every moment's cached answer: a remount (Home, Posted, a first hire) never reopens it this session.
    queryClient.setQueriesData({ queryKey: ["sms-phone-prompt"] }, false);
    void supabase.rpc("dismiss_sms_phone_prompt").then(({ data, error }) => {
      // A zero-row answer is not a write: no timestamp back means it was not stored.
      if (error || !data) {
        report(error ?? new Error("dismiss_sms_phone_prompt stored nothing"), {
          tags: { area: "sms_phone_prompt", moment },
          context: { words: error ? rpcErrorMessage("dismiss_sms_phone_prompt", error) : null },
        });
      }
    });
  }, [moment, queryClient]);
  const onAllSet = useCallback((alreadyOn: boolean) => {
    if (alreadyOn) close();
    else setAllSet(true);
  }, [close]);
  useEffect(() => {
    if (!allSet || closed) return;
    const t = setTimeout(close, SMS_PROMPT_ALL_SET_MS);
    return () => clearTimeout(t);
  }, [allSet, closed, close]);
  if (closed) return null;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent onOpenAutoFocus={(e) => e.preventDefault()} data-sms-phone-prompt={moment}>
        <DialogHero title={allSet ? "You're all set" : moment === "has_phone" ? SMS_TEXTS_PROMPT_TITLE : SMS_PHONE_PROMPT_TITLE} />
        <DialogBody>
          {!allSet && <p>We'll text you when something on your job needs you and you haven't seen it in the app.</p>}
          <SmsAlertsCard inPrompt onAllSet={onAllSet} />
        </DialogBody>
        <DialogFooter>
          <DialogSecondaryAction onClick={close}>{allSet ? "Close" : "Not now"}</DialogSecondaryAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
