import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuthReady } from "@/hooks/useAuthReady";
import { useRequestPushPermissionOutcome } from "@/lib/nativePush";
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
 */
export function useNotifyWhenWorkLands(): () => Promise<void> {
  const navigate = useNavigate();
  const { user } = useAuthReady();
  const requestPush = useRequestPushPermissionOutcome();
  return useCallback(async () => {
    if (!user) {
      navigate(NOTIFY_SIGNUP_URL);
      return;
    }
    try {
      await saveNotifyPreference(user.id);
    } catch (err) {
      report(err, { tags: { source: "notifyWhenWorkLands.save" } });
      toast.error("We couldn't save that. Please try again.");
      return;
    }
    const outcome = await requestPush();
    if (outcome === "granted") {
      toast.success("You're set. We'll ping you when paid work lands.");
    } else {
      toast.message("Job alerts are on, but this device isn't allowed to notify you. Turn on notifications for Helpr in Settings.");
    }
  }, [user, navigate, requestPush]);
}
