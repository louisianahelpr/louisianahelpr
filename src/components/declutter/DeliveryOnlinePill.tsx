/**
 * "Online for deliveries" in the header while the Helpr is online (Q2440, owner-approved 2026-10-27).
 * Desktop: inside the top bar, left of the bell. Phone web and the app: a small chip above the bottom
 * dock (they have no shared top bar). Tapping it opens Deliver for pay. Renders nothing while offline,
 * signed out, or before the switch row is read; a failed read hides it (the Deliver page still works).
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useChromeReadsMayStart } from "@/hooks/usePageReadsSettled";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { fetchOnlineStatus, isOnline } from "@/lib/helprTasks/online";

function useOnlineNow(): boolean {
  const { user } = useCurrentUser();
  const chromeReadsMayStart = useChromeReadsMayStart();
  const q = useQuery({
    queryKey: ["helpr-tasks", "online", user?.id ?? ""],
    queryFn: () => fetchOnlineStatus(user?.id ?? ""),
    enabled: !!user?.id && chromeReadsMayStart,
    staleTime: 60_000,
    meta: { persist: false },
  });
  // Re-read the clock each minute so the pill leaves on its own at the auto-off.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return isOnline(q.data, now);
}

const pill = "inline-flex min-h-9 items-center gap-1.5 rounded-full bg-primary px-3 text-ds-12 font-semibold text-primary-foreground";

export function DeliveryOnlinePill({ placement }: { placement: "header" | "dock" }) {
  const online = useOnlineNow();
  // The same split DesktopTopNav uses (never a Tailwind width class: a wide native WebView is not desktop).
  const isWebDesktop = useIsWebDesktop();
  if (!online) return null;
  if (placement === "dock" && isWebDesktop) return null;
  const body = (
    <Link to="/declutter?view=deliver" className={pill} aria-label="Online for deliveries. Open Deliver for pay">
      <span aria-hidden className="h-2 w-2 rounded-full bg-white" />
      Online for deliveries
    </Link>
  );
  if (placement === "header") return body;
  return createPortal(
    <div data-rail-inset="" className="pointer-events-none fixed inset-x-0 z-40 flex justify-center"
      style={{ bottom: "calc(var(--safe-area-bottom, 0px) + var(--bottom-nav-h, 96px) + 8px)" }}>
      <span className="pointer-events-auto">{body}</span>
    </div>,
    document.body,
  );
}
