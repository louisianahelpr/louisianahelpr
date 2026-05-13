import { useState, useEffect } from "react";
import { Bell, X } from "lucide-react";
import { isPushSupported, requestPushPermission, registerServiceWorker } from "@/lib/pushNotifications";
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
  const requestNativePush = useRequestPushPermission();

  useEffect(() => {
    if (isNativePlatform) {
      if (!isSnoozed()) setShow(true);
      return;
    }

    if (!isPushSupported()) return;
    const currentPermission = Notification.permission;
    setPermission(currentPermission);

    if (currentPermission === "default" && !isSnoozed()) {
      setShow(true);
    }
  }, []);

  const handleEnable = async () => {
    if (isNativePlatform) {
      const granted = await requestNativePush();
      setPermission(granted ? "granted" : "denied");
    } else {
      await registerServiceWorker();
      const granted = await requestPushPermission();
      setPermission(granted ? "granted" : "denied");
    }
    snooze();
    setShow(false);
  };

  const handleDismiss = () => {
    snooze();
    setShow(false);
  };

  if (!show) return null;

  return (
    <div
      className="rounded-2xl liquid-glass px-3.5 py-2.5 mb-3 animate-in fade-in slide-in-from-top-1 duration-300"
      style={{
        backgroundImage:
          "radial-gradient(70% 90% at 100% 0%, hsl(var(--burnt-sienna) / 0.08) 0%, transparent 55%)",
      }}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
          style={{
            background: "hsl(var(--bark) / 0.12)",
            color: "hsl(var(--bark))",
            border: "0.5px solid hsl(var(--bark) / 0.22)",
          }}
        >
          <Bell className="w-4 h-4" strokeWidth={2.25} />
        </div>
        <div className="flex-1 min-w-0">
          <p
            className="font-serif italic uppercase"
            style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
          >
            Stay in the loop
          </p>
          <p
            className="font-display italic font-bold leading-tight"
            style={{ fontSize: "0.95rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.012em" }}
          >
            Turn on notifications.
          </p>
          <p
            className="font-serif italic mt-0.5"
            style={{ fontSize: "0.72rem", color: "hsl(var(--olivewood) / 0.7)" }}
          >
            Job matches, messages &amp; updates
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleEnable}
            className="h-9 px-4 rounded-full text-[0.72rem] font-sans font-semibold active:scale-[0.97] transition-transform"
            style={{
              background: "hsl(var(--bark))",
              color: "hsl(var(--parchment))",
              border: "1px solid hsl(70 22% 24%)",
              letterSpacing: "0.01em",
              boxShadow:
                "inset 0 1px 0 0 rgba(255,255,255,0.12), " +
                "0 1px 2px hsl(var(--bark) / 0.18), " +
                "0 8px 18px -6px hsl(var(--bark) / 0.45)",
            }}
          >
            Enable
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss"
            className="h-9 w-9 inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/50 active:scale-[0.95] transition"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
