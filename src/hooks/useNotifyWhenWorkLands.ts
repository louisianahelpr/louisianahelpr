import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuthReady } from "@/hooks/useAuthReady";
import { usePermissionRationale } from "@/hooks/usePermissionRationale";
import type { PushRequestOutcome } from "@/lib/nativePush";
import { loadModule } from "@/lib/loadModule";
import { report } from "@/lib/errorLogger";
import { NOTIFY_SIGNUP_URL } from "@/lib/jobIntent";
import { saveNotifyPreference } from "@/lib/notifyWhenWorkLands";

/**
 * The one handler behind every "Notify Me When Work Lands" button (guest empty
 * state, guest map empty state, signed-in feed empty state). Push only (Q1313):
 *
 *   signed out -> quick sign-up ("Sign up to get notified")
 *   signed in  -> save push_enabled + job_matches, then ask the device for push
 *                 permission (rationale dialog first, then the OS prompt).
 *
 * The preference is saved BEFORE the permission ask, so a member who says no to
 * the OS prompt still has job matches on and gets in-app pings; the toast tells
 * them the device part is off rather than claiming they are set.
 *
 * nativePush.ts loads on the tap, beside the save (Q2705 pass 3): this hook sits in signed-in /jobs' feed, and a
 * static import put that file on the first screen for a button only an empty feed shows. It is in hand before the
 * save answers, so the permission ask runs exactly as before.
 */
export function useNotifyWhenWorkLands(): () => Promise<void> {
  const navigate = useNavigate();
  const { user } = useAuthReady();
  const { request } = usePermissionRationale();
  return useCallback(async () => {
    if (!user) {
      navigate(NOTIFY_SIGNUP_URL);
      return;
    }
    const push = loadModule(() => import("@/lib/nativePush"));
    // A failed load is reported below, where the ask would have run; never an unhandled rejection meanwhile.
    push.catch(() => null);
    try {
      await saveNotifyPreference(user.id);
    } catch (err) {
      report(err, { tags: { source: "notifyWhenWorkLands.save" } });
      toast.error("We couldn't save that. Please try again.");
      return;
    }
    let outcome: PushRequestOutcome;
    try {
      const m = await push;
      // null: a stale chunk, and the page is already reloading to recover. Nothing to show before it goes.
      if (!m) return;
      outcome = await m.requestPushPermissionOutcome(request);
    } catch (e) {
      // The preference is already saved; a failed permission prompt must not
      // become an unhandled rejection with no message (lh-authz-rls nit 1).
      report(e, { tags: { source: "notifyWhenWorkLands.push" } });
      outcome = "refused";
    }
    // The bare toast(), never toast.success/.message: toastPolicy suppresses
    // those, and with notifications already allowed iOS shows no prompt, so
    // the tap looked like it did nothing (owner, on device, 2026-10-06).
    if (outcome === "granted") {
      toast("You're set. We'll ping you when paid work lands.");
    } else if (outcome === "dismissed") {
      // Not now in our own rationale dialog: no OS prompt was shown and nothing is blocked, so
      // sending them to Settings would be wrong (Q946, the declined-vs-denied signal).
      toast("Job alerts are on. You can allow notifications on this device later.");
    } else {
      toast.warning("Job alerts are on, but this device isn't allowed to notify you. Turn on notifications for Helpr in Settings.");
    }
  }, [user, navigate, request]);
}
