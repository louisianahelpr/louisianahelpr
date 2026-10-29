import { useCallback, useSyncExternalStore } from "react";
import { safeStorage } from "@/lib/safeStorage";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { SECTIONS, type SectionKey } from "./sectionsConfig";

/**
 * Which sections a member shows, and in what order (owner, 2026-10-19:
 * "Customize"). Hidden sections leave the bottom nav AND Home. Home and
 * Messages are not sections, so they always show. At least one section stays
 * on: hiding the last one is refused.
 *
 * Stored per member under "<key>:<userId>" (never one global key: one
 * account's choice must not paint on the next account to sign in).
 */
export interface SectionPrefs {
  order: SectionKey[];
  hidden: SectionKey[];
}

const KEY = "helpr_section_prefs";
const ALL = SECTIONS.map((s) => s.key);
const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; prefs: SectionPrefs }>();

function normalizePrefs(input: unknown): SectionPrefs {
  const obj = (input && typeof input === "object" ? input : {}) as Partial<SectionPrefs>;
  const isKey = (k: unknown): k is SectionKey => typeof k === "string" && (ALL as string[]).includes(k);
  const order = Array.isArray(obj.order) ? obj.order.filter(isKey) : [];
  for (const k of ALL) if (!order.includes(k)) order.push(k);
  const dedup = order.filter((k, i) => order.indexOf(k) === i);
  let hidden = Array.isArray(obj.hidden) ? obj.hidden.filter(isKey) : [];
  if (hidden.length >= ALL.length) hidden = [];
  return { order: dedup, hidden };
}

function readRaw(userId: string | undefined): string | null {
  if (!userId) return null;
  try {
    return safeStorage.getItem(`${KEY}:${userId}`);
  } catch {
    return null; // storage blocked: defaults
  }
}

function parseRaw(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null; // a malformed value reads as defaults
  }
}

function read(user: string | undefined): SectionPrefs {
  const uid = user ?? "anon"; // the cache is keyed by user id (moduleCachesClearedOnSignOut)
  const raw = readRaw(user);
  const hit = cache.get(uid);
  if (hit && hit.raw === raw) return hit.prefs;
  const prefs = normalizePrefs(parseRaw(raw));
  cache.set(uid, { raw, prefs });
  return prefs;
}

/**
 * Would hiding `key` leave no OPEN section showing? (A3-C13, app audit
 * 2026-10-29.) The old rule counted every section, open or not: with only
 * Jobs open, a member could switch Jobs off (one of four hidden), and + Create
 * then listed nothing but three "Coming soon" rows. `openKeys` are the
 * sections live for this viewer (useOpenSectionKeys); with none known the
 * rule falls back to "not every section".
 */
export function hidesLastOpenSection(hidden: readonly SectionKey[], key: SectionKey, openKeys: readonly SectionKey[]): boolean {
  const next = new Set([...hidden, key]);
  if (next.size >= ALL.length) return true;
  return openKeys.length > 0 && openKeys.every((k) => next.has(k));
}

/** What a refused switch-off says. */
export const KEEP_ONE_OPEN_TOAST = "Keep at least one open section on";

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useSectionPrefs() {
  const { user } = useCurrentUser();
  const userId = user?.id;
  const prefs = useSyncExternalStore(subscribe, () => read(userId));

  const save = useCallback(
    (next: SectionPrefs) => {
      if (!userId) return;
      try {
        safeStorage.setItem(`${KEY}:${userId}`, JSON.stringify(normalizePrefs(next)));
      } catch {
        /* best-effort: the choice lasts this session only */
      }
      listeners.forEach((l) => l());
    },
    [userId],
  );

  /**
   * Returns false (and changes nothing) when it would hide the last section,
   * or (given `openKeys`) the last section OPEN to this viewer.
   */
  const setHidden = useCallback(
    (key: SectionKey, hide: boolean, openKeys: readonly SectionKey[] = []) => {
      if (hide && hidesLastOpenSection(prefs.hidden, key, openKeys)) return false;
      const hidden = hide ? [...new Set([...prefs.hidden, key])] : prefs.hidden.filter((k) => k !== key);
      save({ ...prefs, hidden });
      return true;
    },
    [prefs, save],
  );

  const move = useCallback(
    (key: SectionKey, dir: -1 | 1) => {
      const order = [...prefs.order];
      const i = order.indexOf(key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      save({ ...prefs, order });
    },
    [prefs, save],
  );

  /** First run (board 53): put the member's picks first, the rest after in their current order. */
  const putFirst = useCallback(
    (keys: SectionKey[]) => {
      const first = keys.filter((k, i) => keys.indexOf(k) === i);
      save({ ...prefs, order: [...first, ...prefs.order.filter((k) => !first.includes(k))] });
    },
    [prefs, save],
  );

  /** The shown sections, in the member's order. */
  const visible = prefs.order.filter((k) => !prefs.hidden.includes(k)).map((k) => SECTIONS.find((s) => s.key === k)!);
  return { prefs, visible, setHidden, move, putFirst };
}
