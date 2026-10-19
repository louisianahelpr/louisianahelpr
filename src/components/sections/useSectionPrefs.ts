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

export function normalizePrefs(input: unknown): SectionPrefs {
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

function read(userId: string | undefined): SectionPrefs {
  const id = userId ?? "anon";
  const raw = readRaw(userId);
  const hit = cache.get(id);
  if (hit && hit.raw === raw) return hit.prefs;
  const prefs = normalizePrefs(parseRaw(raw));
  cache.set(id, { raw, prefs });
  return prefs;
}

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

  /** Returns false (and changes nothing) when it would hide the last section. */
  const setHidden = useCallback(
    (key: SectionKey, hide: boolean) => {
      const hidden = hide ? [...new Set([...prefs.hidden, key])] : prefs.hidden.filter((k) => k !== key);
      if (hidden.length >= ALL.length) return false;
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

  /** The shown sections, in the member's order. */
  const visible = prefs.order.filter((k) => !prefs.hidden.includes(k)).map((k) => SECTIONS.find((s) => s.key === k)!);
  return { prefs, visible, setHidden, move };
}
