import { useEffect, useState, useSyncExternalStore, type ComponentType } from "react";
import { NotificationTrigger } from "./NotificationTrigger";
import {
  subscribeNotifications,
  getNotificationSnapshot,
  getNotificationServerSnapshot,
  bellUnreadCount,
} from "./notificationStore";
import { whenPageSettled } from "@/lib/routePrefetch";
import { report } from "@/lib/errorLogger";

/**
 * THE BELL, WITHOUT THE PANEL ON THE FIRST LOAD (B65, Home speed).
 *
 * Every title bar mounts the bell, and NotificationPanel (the list, the
 * popover, pull-to-refresh, push setup) sat on the first load of every
 * signed-in page although nobody sees it until they tap. This draws the same
 * trigger, with the same shared unread count (notificationStore, fed by
 * useNavUnreadCount on every route), and swaps in the real panel once the
 * page has settled, or at once on the first tap (which then opens it).
 * Until then the panel's own extras (the chime, the first 800 ms list load)
 * have not started; the feed and the badge do not depend on them.
 */
type Panel = ComponentType<{ triggerClassName?: string; defaultOpen?: boolean }>;

let loaded: Panel | null = null;
let pending: Promise<Panel | null> | null = null;

async function importPanel(): Promise<Panel | null> {
  try {
    const mod = await import("@/components/NotificationPanel");
    loaded = mod.default;
    return loaded;
  } catch (err) {
    // A failed chunk (offline, stale deploy): the bell stays a bell and the next tap retries.
    report(err, { tags: { source: "NotificationBell.load" } });
    pending = null;
    return null;
  }
}

function loadPanel(): Promise<Panel | null> {
  if (loaded) return Promise.resolve(loaded);
  pending ??= importPanel();
  return pending;
}

export default function NotificationBell({ triggerClassName }: { triggerClassName?: string }) {
  const [panel, setPanel] = useState<Panel | null>(() => loaded);
  const [openOnLoad, setOpenOnLoad] = useState(false);
  const { notifications, unreadTotal } = useSyncExternalStore(
    subscribeNotifications,
    getNotificationSnapshot,
    getNotificationServerSnapshot,
  );

  useEffect(() => {
    if (panel) return;
    let live = true;
    const swap = async () => {
      const p = await loadPanel();
      if (live && p) setPanel(() => p);
    };
    const stop = whenPageSettled(() => void swap());
    return () => { live = false; stop(); };
  }, [panel]);

  if (panel) {
    const Loaded = panel;
    return <Loaded triggerClassName={triggerClassName} defaultOpen={openOnLoad} />;
  }
  return (
    <NotificationTrigger
      unreadCount={bellUnreadCount({ notifications, unreadTotal })}
      className={triggerClassName}
      // What PopoverTrigger adds to the loaded panel's trigger, so the bell reads the same before and after.
      aria-haspopup="dialog"
      aria-expanded={false}
      data-state="closed"
      onClick={async () => {
        setOpenOnLoad(true);
        const p = await loadPanel();
        if (p) setPanel(() => p);
      }}
    />
  );
}
