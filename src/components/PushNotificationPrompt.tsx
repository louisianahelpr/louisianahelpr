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
    <div className="rounded-2xl liquid-glass px-3.5 py-2.5 mb-3 animate-in fade-in slide-in-from-top-1 duration-300">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Bell className="w-4 h-4 text-primary" strokeWidth={2.25} />
        </div>
        <div className="flex-1 min-w-0">
          <p
            className="font-display italic font-bold text-[0.92rem] leading-tight"
            style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.012em" }}
          >
            Enable notifications
          </p>
          <p
            className="font-serif italic text-[0.72rem] leading-snug mt-0.5"
            style={{ color: "hsl(var(--olivewood) / 0.7)" }}
          >
            Job matches, messages &amp; updates
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleEnable}
            className="h-8 px-3 rounded-full bg-primary text-primary-foreground text-[12px] font-semibold shadow-[0_2px_8px_-2px_hsl(var(--primary)/0.35)] active:scale-[0.97] transition-transform"
          >
            Enable
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss"
            className="h-8 w-8 inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/50 active:scale-[0.95] transition"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
