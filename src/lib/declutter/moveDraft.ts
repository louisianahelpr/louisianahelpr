import type { MoveRow } from "@/lib/declutter/moves";

/**
 * Audit #33 (Declutter deep audit, 2026-10-28): nothing typed on Moving out
 * survived a reload, including the item list a photo scan took over a minute
 * to make. The page keeps what is not saved yet (the move's date, area and
 * pickup address, and the unsaved rows) in sessionStorage: it outlives a
 * reload, not the tab, so a home address does not linger on a shared device.
 * Per member. Storage can be missing or throw (private mode, blocked site
 * data); then the page simply starts empty, as it always did.
 */
export interface MoveDraft {
  date: string;
  areaLabel: string;
  pickupAddress: string;
  rows: MoveRow[];
}

const key = (userId: string) => `lh:declutter-move-draft:${userId}`;

export function readMoveDraft(userId: string): MoveDraft | null {
  try {
    const raw = window.sessionStorage.getItem(key(userId));
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<MoveDraft>;
    return {
      date: typeof d.date === "string" ? d.date : "",
      areaLabel: typeof d.areaLabel === "string" ? d.areaLabel : "",
      pickupAddress: typeof d.pickupAddress === "string" ? d.pickupAddress : "",
      rows: Array.isArray(d.rows) ? d.rows.filter((r): r is MoveRow => !!r && typeof r.key === "string") : [],
    };
  } catch (err) {
    // A corrupt or unreadable entry: start empty, as before the draft existed.
    console.warn("[declutter] move draft unreadable", err);
    return null;
  }
}

export function writeMoveDraft(userId: string, draft: MoveDraft): void {
  try {
    const empty = !draft.date && !draft.areaLabel && !draft.pickupAddress && draft.rows.length === 0;
    if (empty) window.sessionStorage.removeItem(key(userId));
    else window.sessionStorage.setItem(key(userId), JSON.stringify(draft));
  } catch (err) {
    // Storage full or blocked: the page still works, it just won't survive a reload.
    console.warn("[declutter] move draft not kept", err);
  }
}
