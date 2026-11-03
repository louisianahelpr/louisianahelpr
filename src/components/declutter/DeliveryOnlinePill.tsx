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
import { fetchOnlineStatus, isOnline, type OnlineStatus } from "@/lib/helprTasks/online";

const ONLINE_STALE_MS = 60_000;

/**
 * This tab's last answer (B58, 2026-11-03, docs/OPEN.md Q104): helpr_delivery_online went out on every signed-in page
 * load (157 calls in Journeys run 41665299005) although the query already counts an answer fresh for a minute; a
 * full page load simply lost it. sessionStorage (this tab only, gone with it), keyed by user, and used only while
 * younger than ONLINE_STALE_MS, so nothing is shown older than the in-memory cache would have shown it. Still never
 * in the 24 h device copy (`persist: false`). The auto-off is read against the clock below either way.
 */
const TAB_COPY_KEY = "lh-online-now:";
type TabCopy = { at: number; row: OnlineStatus | null };
function readTabCopy(uid: string, now = Date.now()): TabCopy | null {
  if (!uid) return null;
  try {
    const c = JSON.parse(sessionStorage.getItem(`${TAB_COPY_KEY}${uid}`) ?? "null") as TabCopy | null;
    return c && typeof c.at === "number" && now - c.at < ONLINE_STALE_MS ? c : null;
  } catch {
    return null; // unreadable copy: read from the server as before
  }
}
function writeTabCopy(uid: string, row: OnlineStatus | null): void {
  try {
    sessionStorage.setItem(`${TAB_COPY_KEY}${uid}`, JSON.stringify({ at: Date.now(), row } satisfies TabCopy));
  } catch {
    /* storage full or unavailable: the next load reads from the server */
  }
}

function useOnlineNow(): boolean {
  const { user } = useCurrentUser();
  const chromeReadsMayStart = useChromeReadsMayStart();
  const uid = user?.id ?? "";
  const copy = readTabCopy(uid);
  const q = useQuery({
    queryKey: ["helpr-tasks", "online", uid],
    queryFn: async () => {
      const row = await fetchOnlineStatus(uid);
      writeTabCopy(uid, row);
      return row;
    },
    enabled: !!user?.id && chromeReadsMayStart,
    staleTime: ONLINE_STALE_MS,
    // A reload in the same tab starts from the last answer while it is still inside this same staleTime, instead
    // of reading again (Q104).
    initialData: copy?.row,
    initialDataUpdatedAt: copy?.at,
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
