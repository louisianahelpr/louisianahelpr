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
/** The hidden-unread bar. One definition so the invisible loading-frame copy
    and the real bar cannot differ in height. */
export function HiddenUnreadBar({ count, onShowAll, held }: { count: number; onShowAll?: () => void; held?: boolean }) {
  const bar = (
    <button
      type="button"
      onClick={onShowAll}
      tabIndex={held ? -1 : undefined}
      className="w-full flex items-center gap-2 rounded-ds-md px-3 py-2.5 btn-press transition-colors text-left"
      style={{
        background: "hsl(var(--amber-tint) / 0.10)",
        border: "0.5px solid hsl(var(--amber-tint) / 0.30)",
      }}
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
  );
  return held ? <div aria-hidden="true" style={{ visibility: "hidden" }}>{bar}</div> : bar;
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

export function readCachedHiddenUnread(userId: string | null): number {
  try {
    const [owner, raw] = (localStorage.getItem(HIDDEN_UNREAD_CACHE_KEY) ?? "").split(":");
    if (userId && owner !== userId) return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0; // storage blocked: first-visit behaviour, nothing held
  }
}

export function writeCachedHiddenUnread(userId: string, count: number) {
  try {
    localStorage.setItem(HIDDEN_UNREAD_CACHE_KEY, `${userId}:${count}`);
  } catch {
    // storage blocked: the next visit behaves like a first one
  }
}
