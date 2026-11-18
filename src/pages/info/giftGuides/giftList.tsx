import { useSyncExternalStore, type MouseEvent } from "react";
import { ICON_STROKE_PX } from "@/lib/iconWeight";

/**
 * "My list" (owner 2026-11-18): the guides and picks a visitor hearts, kept in this browser only (localStorage, every
 * read and write in try/catch: a private window or blocked storage just means an empty list that lasts the visit).
 * Every heart on the page reads the same store, so a heart and the sidebar count change together.
 */
export interface SavedPick { href: string; name: string }
interface GiftList { guides: string[]; picks: SavedPick[] }

const KEY = "lh-gift-list";
const EMPTY: GiftList = { guides: [], picks: [] };
let memory: GiftList = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function read(): GiftList {
  if (loaded) return memory;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as Partial<GiftList>) : null;
    if (v && Array.isArray(v.guides) && Array.isArray(v.picks)) memory = { guides: v.guides, picks: v.picks };
  } catch {
    // Storage blocked or the saved value is not ours: start from an empty list for this visit.
    memory = EMPTY;
  }
  return memory;
}

function write(next: GiftList) {
  memory = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage blocked (private window, full): the list still works for this visit, in memory.
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const toggleGuide = (slug: string) => {
  const cur = read();
  write({ ...cur, guides: cur.guides.includes(slug) ? cur.guides.filter((s) => s !== slug) : [...cur.guides, slug] });
};
export const togglePick = (pick: SavedPick) => {
  const cur = read();
  write({ ...cur, picks: cur.picks.some((p) => p.href === pick.href && p.name === pick.name) ? cur.picks.filter((p) => !(p.href === pick.href && p.name === pick.name)) : [...cur.picks, pick] });
};

/** The visitor's list; re-renders whenever any heart changes it. */
export const useGiftList = (): GiftList => useSyncExternalStore(subscribe, read, () => EMPTY);

/** For tests: forget the in-memory copy so the next read goes back to storage. */
export const resetGiftListForTests = () => {
  loaded = false;
  memory = EMPTY;
};

/**
 * A heart (owner 2026-11-18): a real button with aria-pressed, never inside the link it sits on, so tapping it saves
 * and does not open the guide or the shop.
 */
export function Heart({ saved, label, onToggle, className }: { saved: boolean; label: string; onToggle: () => void; className: string }) {
  const click = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onToggle();
  };
  return (
    <button type="button" className={`gg-heart ${className}`} aria-pressed={saved} aria-label={label} onClick={click} data-gift-heart="">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.7 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.5 0 5.8 3.4 4.5 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" fill={saved ? "#b26862" : "none"} stroke="#b26862" strokeWidth={ICON_STROKE_PX} strokeLinejoin="round" />
      </svg>
    </button>
  );
}
