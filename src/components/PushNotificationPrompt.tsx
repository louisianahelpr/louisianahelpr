import { useState, useEffect } from "react";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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
    <div className="rounded-lg liquid-glass px-3 py-2 mb-3 relative animate-in fade-in duration-300">
      <button
        onClick={handleDismiss}
        className="absolute top-1.5 right-1.5 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-3 h-3" />
      </button>
      <div className="flex items-center gap-2 pr-5">
        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Bell className="w-3.5 h-3.5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground leading-tight">Enable notifications</p>
          <p className="text-[11px] text-muted-foreground leading-tight">Job matches, messages & updates</p>
        </div>
        <Button size="sm" onClick={handleEnable} className="h-7 px-2 text-xs flex-shrink-0">
          Enable
        </Button>
      </div>
    </div>
  );
};
