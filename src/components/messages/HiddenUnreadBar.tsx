/**
 * The inbox's hidden-unread bar ("N unread conversations aren't in Active —
 * show all"), shown ON TOP of the list with its space held while loading
 * (owner, 2026-09-26, MQ28: "back on top, space held"). The count only exists
 * once the inbox lands, so a bar that simply appeared pushed every row down
 * (CLS 0.059 at 375). The last count this device saw is kept, and while the
 * list loads a `held` (invisible, aria-hidden) copy with that text holds its
 * height above the skeleton. A device's very first visit has nothing cached
 * and can still shift once (page-settle KNOWN).
 */
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";

/** The hidden-unread bar. One definition so the invisible loading-frame copy
    and the real bar cannot differ in height. The X (owner, 2026-09-26: "an x
    in that top bar ... so they can x it out") hides it until a NEW unread
    conversation lands outside Active; see readDismissedHiddenUnread. */
export function HiddenUnreadBar({
  count,
  onShowAll,
  onDismiss,
  held,
}: {
  count: number;
  onShowAll?: () => void;
  onDismiss?: () => void;
  held?: boolean;
}) {
  const bar = (
    <div
      className="w-full flex items-stretch rounded-ds-md transition-colors"
      style={{
        background: "hsl(var(--amber-tint) / 0.10)",
        border: "0.5px solid hsl(var(--amber-tint) / 0.30)",
      }}
    >
      <button
        type="button"
        onClick={onShowAll}
        tabIndex={held ? -1 : undefined}
        className="flex-1 min-w-0 flex items-center gap-2 pl-3 pr-1 py-2.5 btn-press text-left"
      >
        <span
          className="shrink-0 w-2 h-2 rounded-full"
          style={{ background: "hsl(var(--burnt-sienna))" }}
          aria-hidden="true"
        />
        <span
          className="font-sans text-ds-13 leading-snug"
          style={{ color: "hsl(var(--olivewood) / 0.9)" }}
        >
          {count === 1
            ? "1 unread conversation isn't in Active — show all"
            : `${count} unread conversations aren't in Active — show all`}
        </span>
      </button>
      <button
        type="button"
        onClick={onDismiss}
        tabIndex={held ? -1 : undefined}
        aria-label="Dismiss"
        className="shrink-0 w-11 flex items-center justify-center btn-press"
        style={{ color: "hsl(var(--olivewood) / 0.6)" }}
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
  return held ? <div aria-hidden="true" style={{ visibility: "hidden" }}>{bar}</div> : bar;
}

/**
 * The hidden-unread count this device dismissed the bar at, stored as
 * "<userId>:<count>". The bar shows again only when the live count rises
 * above it (a new unread conversation outside Active), so the X is not a
 * permanent mute. When the count falls, the stored value falls with it
 * (useHiddenUnreadBarMarks), so the next rise re-shows.
 */
const HIDDEN_UNREAD_DISMISSED_KEY = "helpr_inbox_hidden_unread_dismissed";

function readDismissedHiddenUnread(userId: string | null): number {
  try {
    const [owner, raw] = (localStorage.getItem(HIDDEN_UNREAD_DISMISSED_KEY) ?? "").split(":");
    if (userId && owner !== userId) return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0; // storage blocked: the bar shows, as before the X existed
  }
}

function writeDismissedHiddenUnread(userId: string, count: number) {
  try {
    localStorage.setItem(HIDDEN_UNREAD_DISMISSED_KEY, `${userId}:${count}`);
  } catch {
    // storage blocked: the dismissal lasts this render only
  }
}

/**
 * The last hidden-unread count this device saw (MQ28), stored as
 * "<userId>:<count>". One device-level key, not one per account, because
 * the inbox's first skeleton frame renders BEFORE `userId` resolves: a
 * per-account read waited for it and the held space arrived ~15ms after
 * the skeleton, shifting it (measured, 2026-09-26). While `userId` is
 * still null the stored count is trusted; once it resolves, a count
 * stored by a different account is dropped.
 */
const HIDDEN_UNREAD_CACHE_KEY = "helpr_inbox_hidden_unread";

function readCachedHiddenUnread(userId: string | null): number {
  try {
    const [owner, raw] = (localStorage.getItem(HIDDEN_UNREAD_CACHE_KEY) ?? "").split(":");
    if (userId && owner !== userId) return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0; // storage blocked: first-visit behaviour, nothing held
  }
}

function writeCachedHiddenUnread(userId: string, count: number) {
  try {
    localStorage.setItem(HIDDEN_UNREAD_CACHE_KEY, `${userId}:${count}`);
  } catch {
    // storage blocked: the next visit behaves like a first one
  }
}

/**
 * Both marks the inbox needs: the cached count (read once, written back only
 * from a settled, unsearched Active view, the same conditions the real bar
 * renders under) and the dismissed count behind the X (hidden until the count
 * rises past it; a falling count lowers it, so the next new one re-shows).
 */
export function useHiddenUnreadBarMarks(userId: string | null, count: number, loading: boolean, settledView: boolean) {
  const cachedHiddenUnread = useMemo(() => readCachedHiddenUnread(userId), [userId]);
  useEffect(() => {
    if (loading || !userId || !settledView) return;
    writeCachedHiddenUnread(userId, count);
  }, [loading, userId, settledView, count]);

  const [dismissedHiddenUnread, setDismissed] = useState(() => readDismissedHiddenUnread(userId));
  useEffect(() => {
    setDismissed(readDismissedHiddenUnread(userId));
  }, [userId]);
  useEffect(() => {
    if (loading || !userId || count >= dismissedHiddenUnread) return;
    writeDismissedHiddenUnread(userId, count);
    setDismissed(count);
  }, [loading, userId, count, dismissedHiddenUnread]);

  const dismissHiddenUnread = () => {
    setDismissed(count);
    if (userId) writeDismissedHiddenUnread(userId, count);
  };
  return { cachedHiddenUnread, dismissedHiddenUnread, dismissHiddenUnread };
}
