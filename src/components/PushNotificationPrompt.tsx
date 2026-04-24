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
    // On native iOS/Android, always show our pre-prompt (the OS prompt only
    // fires if the user taps Enable). On web, only show if Notification API
    // is available and permission is undecided.
    if (isNativePlatform) {
      const dismissed = safeStorage.getItem("push-prompt-dismissed");
      if (!dismissed) {
        const timer = setTimeout(() => setShow(true), 3000);
        return () => clearTimeout(timer);
      }
      return;
    }

    if (!isPushSupported()) return;
    const currentPermission = Notification.permission;
    setPermission(currentPermission);

    if (currentPermission === "default") {
      const dismissed = safeStorage.getItem("push-prompt-dismissed");
      if (!dismissed) {
        const timer = setTimeout(() => setShow(true), 3000);
        return () => clearTimeout(timer);
      }
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
    <div className="fixed bottom-20 left-4 right-4 md:left-auto md:right-6 md:bottom-6 md:w-96 z-50 animate-in slide-in-from-bottom-4 duration-300">
      <div className="rounded-xl border border-border bg-card p-4 shadow-lg">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Bell className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-foreground text-sm">Enable notifications?</p>
            <p className="text-xs text-muted-foreground mt-1">
              Get instant alerts for new job matches, messages, and status updates.
            </p>
            <div className="flex gap-2 mt-3">
              <Button size="sm" onClick={handleEnable} className="text-xs">
                <Bell className="w-3 h-3 mr-1" /> Enable
              </Button>
              <Button size="sm" variant="ghost" onClick={handleDismiss} className="text-xs text-muted-foreground">
                Not now
              </Button>
            </div>
          </div>
          <button onClick={handleDismiss} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
