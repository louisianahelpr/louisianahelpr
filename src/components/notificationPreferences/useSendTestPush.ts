import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { hapticError } from "@/lib/haptics";
import { confirmConsequential } from "@/lib/toastPolicy";
import { functionErrorMessage } from "@/lib/supabaseResult";
import { emailSkipCopy, joinList, type TestSendResult } from "./testNotificationCopy";

/** The Notifications tab's "Send test" (moved out of NotificationPreferences.tsx, Q806): its in-flight flag and the send. */
export function useSendTestPush(userId: string | null, setPushTokenCount: (n: number | null) => void) {
  const [sendingTest, setSendingTest] = useState(false);
  // Test notification — proves the pipeline end-to-end. Insert a
  // notification row for ourselves; a DB trigger fans it out to
  // send-push-notification (see migration 20260506120000) AND
  // create-notification itself chains send-notification-email with the
  // service-role key. create-notification is the user-callable wrapper
  // that lets a signed-in user target *themselves* (it 403s on any
  // other user_id unless the caller is admin), so we don't need a
  // service-role bearer here.
  //
  // Previously this whole button was disabled with zero registered push
  // devices, which left web/desktop users (and anyone who hasn't opened
  // the native app yet) with no way to test ANY channel — even though
  // the same call also lands an in-app bell notification and an email.
  // Push is just one of three channels this call exercises, so only the
  // absence of a signed-in user (or a call in flight) should block it.
  const sendTestPush = async () => {
    if (!userId || sendingTest) return;
    setSendingTest(true);
    try {
      // Read `data`, not just `error`. A 200 from create-notification used to
      // be reported as "Test sent — check your email and the bell icon" even on
      // runs where the email had been silently skipped (the Email switch for
      // this category was off, the address was suppressed, or Resend refused
      // it) — the function returned a blanket `{ success: true }` and the copy
      // promised delivery it had no evidence for. It now reports each channel,
      // and this toast says only what actually happened.
      const { data, error } = await supabase.functions.invoke<TestSendResult>(
        "create-notification",
        {
          // The copy is built server-side (Q223): only an admin may send
          // free text, so the test names the fixed "test" template.
          body: { user_id: userId, template: "test" },
        },
      );
      if (error) throw error;

      const channels = data?.channels;
      // An older deploy of the edge function (no `channels` in the body) still
      // has to end in feedback rather than in silence — just without the
      // per-channel claim we can no longer back up.
      if (!channels) {
        confirmConsequential("Test sent — check the bell icon, and your email.");
        return;
      }

      // Keep the row's own copy honest: the device count the server just
      // measured beats whatever we read when the screen first mounted.
      if (typeof channels.push?.devices === "number") {
        setPushTokenCount(channels.push.devices);
      }

      const devices = channels.push?.devices ?? 0;

      const landed: string[] = [];
      if (channels.in_app?.status === "sent") landed.push("the bell icon");
      if (channels.email?.status === "sent") {
        landed.push(channels.email.detail ? `email to ${channels.email.detail}` : "email");
      }
      if (devices > 0) {
        landed.push(`push to ${devices} device${devices === 1 ? "" : "s"}`);
      }

      // Something went wrong that the user did not already know about.
      const issues: string[] = [];
      if (channels.email?.status === "skipped") {
        issues.push(emailSkipCopy(channels.email));
      } else if (channels.email?.status === "failed") {
        issues.push("the email couldn't be sent");
      }
      // Zero registered devices is a stated fact, not a surprise — the row's
      // own subtitle already says so. It is worth repeating in the result so
      // "nothing buzzed my phone" has an answer, but it does not by itself
      // make an otherwise-clean send into a warning.
      const pushNote = devices === 0 ? "no device is registered for push" : null;

      if (landed.length === 0) {
        hapticError();
        toast.error(`Test didn't reach you — ${joinList([...issues, ...(pushNote ? [pushNote] : [])]) || "no channel was available"}.`);
      } else if (issues.length > 0) {
        toast.warning(`Sent to ${joinList(landed)} — but ${joinList([...issues, ...(pushNote ? [pushNote] : [])])}.`);
      } else {
        confirmConsequential(`Sent to ${joinList(landed)}.${pushNote ? " No device is registered for push." : ""}`);
      }
    } catch (err: unknown) {
      hapticError();
      // The SDK's own message on a non-2xx is the useless "Edge Function
      // returned a non-2xx status code"; the real reason is in the response
      // body, which functionErrorMessage digs out.
      toast.error(await functionErrorMessage(err, "Test failed — please try again."));
    } finally {
      setSendingTest(false);
    }
  };
  return { sendingTest, sendTestPush };
}
