import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/**
 * Global offline indicator. Listens to navigator online/offline events
 * and renders a fixed banner above the bottom nav when the user loses
 * connectivity. Silent no-op when online.
 */
const OfflineBanner = () => {
  const [offline, setOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  );

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 left-0 right-0 z-[60] bg-destructive text-destructive-foreground text-xs font-medium py-2 px-4 flex items-center justify-center gap-2 shadow-md"
      style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top, 0px))" }}
    >
      <WifiOff className="w-3.5 h-3.5" />
      You're offline — changes will retry when you reconnect.
    </div>
  );
};

export default OfflineBanner;
