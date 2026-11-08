import { useEffect, useState, useSyncExternalStore, type ComponentType } from "react";
import { NotificationTrigger } from "./NotificationTrigger";
import {
  subscribeNotifications,
  getNotificationSnapshot,
  getNotificationServerSnapshot,
  bellUnreadCount,
} from "./notificationStore";
import { whenPageSettled } from "@/lib/routePrefetch";
import { prefetchNotificationList, prefetchOnIntent } from "./notificationFeed";
import { report } from "@/lib/errorLogger";
import { useBellMessagesUnread } from "./useBellMessagesUnread";

/**
 * THE BELL, WITHOUT THE PANEL ON THE FIRST LOAD (B65, Home speed).
 *
 * Every title bar mounts the bell, and NotificationPanel (the list, the
 * popover, pull-to-refresh, push setup) sat on the first load of every
 * signed-in page although nobody sees it until they tap. This draws the same
 * trigger, with the same shared unread count (notificationStore, fed by
 * useNavUnreadCount on every route), and swaps in the real panel once the
 * page has settled, or at once on the first tap (which then opens it).
 * Until then the panel's own extras (the chime) have not started; the feed
 * and the badge do not depend on them. The All list itself loads only when
 * the panel is about to open (Q104): a hover, focus or touch on either bell
 * starts it, and so does the tap, before the panel's chunk has arrived.
 */
type Panel = ComponentType<{ triggerClassName?: string; defaultOpen?: boolean; withMessages?: boolean }>;

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

/**
 * `withMessages` (owner 11-08, Declutter's Vinted top bar: only the bell and the photo): the bell is also the way to
 * Messages, so its badge is notifications + messages unread, and the panel opens with a Messages row on top.
 */
export default function NotificationBell({ triggerClassName, withMessages = false }: { triggerClassName?: string; withMessages?: boolean }) {
  const [panel, setPanel] = useState<Panel | null>(() => loaded);
  const [openOnLoad, setOpenOnLoad] = useState(false);
  const { notifications, unreadTotal } = useSyncExternalStore(
    subscribeNotifications,
    getNotificationSnapshot,
    getNotificationServerSnapshot,
  );

  const messagesUnread = useBellMessagesUnread(withMessages);

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
    return <Loaded triggerClassName={triggerClassName} defaultOpen={openOnLoad} withMessages={withMessages} />;
  }
  return (
    <NotificationTrigger
      unreadCount={bellUnreadCount({ notifications, unreadTotal }) + messagesUnread}
      withMessages={withMessages}
      className={triggerClassName}
      // What PopoverTrigger adds to the loaded panel's trigger, so the bell reads the same before and after.
      aria-haspopup="dialog"
      aria-expanded={false}
      data-state="closed"
      {...prefetchOnIntent}
      onClick={async () => {
        prefetchNotificationList();
        setOpenOnLoad(true);
        const p = await loadPanel();
        if (p) setPanel(() => p);
      }}
    />
  );
}
