import { useState, useEffect } from "react";
import { Bell, X } from "lucide-react";
import { isPushSupported } from "@/lib/pushNotifications";
import { safeStorage } from "@/lib/safeStorage";
import { isNativePlatform } from "@/lib/nativeInit";
import { useRequestPushPermission } from "@/lib/nativePush";

const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const STORAGE_KEY = "push-prompt-dismissed-at";

const isSnoozed = () => {
  const ts = safeStorage.getItem(STORAGE_KEY);
  if (!ts) return false;
  const parsed = parseInt(ts, 10);
  if (Number.isNaN(parsed)) return true; // legacy "true" value — treat as dismissed
  return Date.now() - parsed < SNOOZE_MS;
};

const snooze = () => {
  safeStorage.setItem(STORAGE_KEY, Date.now().toString());
};

export const PushNotificationPrompt = () => {
  const [show, setShow] = useState(false);
  const [, setPermission] = useState<string>("default");
  const requestPush = useRequestPushPermission();

  useEffect(() => {
    if (isSnoozed()) return;

    if (isNativePlatform) {
      // Mirror the web branch's behavior: only surface the banner when
      // the OS permission is still undecided ("prompt"). Previously this
      // path called setShow(true) unconditionally, which pestered users
      // who had already granted for 30 days and re-prompted users who
      // had already denied (iOS short-circuits the second request, so
      // tapping Enable felt broken).
      let cancelled = false;
      (async () => {
        try {
          const { PushNotifications } = await import("@capacitor/push-notifications");
          const status = await PushNotifications.checkPermissions();
          if (!cancelled && status.receive === "prompt") setShow(true);
        } catch {
          // If the plugin import or permission check fails we silently
          // skip the banner rather than show a broken one.
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    if (!isPushSupported()) return;
    const currentPermission = Notification.permission;
    setPermission(currentPermission);

    if (currentPermission === "default") {
      setShow(true);
    }
  }, []);

  const handleEnable = async () => {
    // Single code path — the hook handles both native and web, and
    // shows the rationale dialog before the OS prompt on both.
    const granted = await requestPush();
    setPermission(granted ? "granted" : "denied");
    snooze();
    setShow(false);
  };

  const handleDismiss = () => {
    snooze();
    setShow(false);
  };

  if (!show) return null;

  return (
    /* Slim single-line banner — was a full three-line card that pushed the
       job feed below the fold. Notification opt-in still has to stay
       surfaced (conversion), so it's compressed rather than removed: one
       row of icon + label + Enable + dismiss. Dismissal persists via the
       same `safeStorage` snooze used by the old card. */
    <div
      className="rounded-full liquid-glass pl-2.5 pr-1 py-1 animate-in fade-in slide-in-from-top-1 duration-300"
      style={{
        backgroundImage:
          "radial-gradient(70% 90% at 100% 0%, hsl(var(--burnt-sienna) / 0.06) 0%, transparent 55%)",
      }}
    >
      <div className="flex items-center gap-2">
        <Bell
          className="w-3.5 h-3.5 shrink-0"
          strokeWidth={2.25}
          style={{ color: "hsl(var(--bark) / 0.85)" }}
        />
        <p
          className="flex-1 min-w-0 truncate font-sans font-medium"
          style={{ fontSize: "0.72rem", color: "hsl(var(--olivewood) / 0.85)" }}
        >
          Notify me about new jobs.
        </p>
        <button
          type="button"
          onClick={handleEnable}
          className="shrink-0 h-6 px-3 rounded-full text-[0.68rem] font-sans font-semibold active:scale-[0.97] transition-transform"
          style={{
            background: "hsl(var(--bark))",
            color: "hsl(var(--parchment))",
            border: "1px solid hsl(70 22% 24%)",
            letterSpacing: "0.01em",
            boxShadow:
              "inset 0 1px 0 0 rgba(255,255,255,0.12), " +
              "0 1px 2px hsl(var(--bark) / 0.18), " +
              "0 4px 10px -6px hsl(var(--bark) / 0.4)",
          }}
        >
          Enable
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss"
          className="shrink-0 h-10 w-10 -my-2 -mr-2 inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/50 active:scale-[0.95] transition"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
