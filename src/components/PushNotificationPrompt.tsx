import { useState, useEffect } from "react";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isPushSupported, requestPushPermission, registerServiceWorker } from "@/lib/pushNotifications";
import { safeStorage } from "@/lib/safeStorage";
import { isNativePlatform } from "@/lib/nativeInit";
import { useRequestPushPermission } from "@/lib/nativePush";

export const PushNotificationPrompt = () => {
  const [show, setShow] = useState(false);
  const [, setPermission] = useState<string>("default");
  const requestNativePush = useRequestPushPermission();

  useEffect(() => {
    if (isNativePlatform) {
      const dismissed = safeStorage.getItem("push-prompt-dismissed");
      if (!dismissed) setShow(true);
      return;
    }

    if (!isPushSupported()) return;
    const currentPermission = Notification.permission;
    setPermission(currentPermission);

    if (currentPermission === "default") {
      const dismissed = safeStorage.getItem("push-prompt-dismissed");
      if (!dismissed) setShow(true);
    }
  }, []);

  const handleEnable = async () => {
    if (isNativePlatform) {
      // Native flow: rationale dialog → OS prompt → register device token.
      const granted = await requestNativePush();
      setPermission(granted ? "granted" : "denied");
    } else {
      await registerServiceWorker();
      const granted = await requestPushPermission();
      setPermission(granted ? "granted" : "denied");
    }
    setShow(false);
  };

  const handleDismiss = () => {
    safeStorage.setItem("push-prompt-dismissed", "true");
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm mb-6 relative animate-in fade-in duration-300">
      <button
        onClick={handleDismiss}
        className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
      <div className="flex flex-col items-center text-center gap-3 pt-2">
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
          <Bell className="w-6 h-6 text-primary" />
        </div>
        <div>
          <p className="font-display font-semibold text-foreground text-base">Enable notifications?</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-md">
            Get instant alerts for new job matches, messages, and status updates.
          </p>
        </div>
        <div className="flex gap-2 mt-1">
          <Button size="sm" onClick={handleEnable}>
            <Bell className="w-4 h-4 mr-1" /> Enable
          </Button>
          <Button size="sm" variant="ghost" onClick={handleDismiss} className="text-muted-foreground">
            Not now
          </Button>
        </div>
      </div>
    </div>
  );
};
