import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { safeStorage } from "@/lib/safeStorage";
import { report } from "@/lib/errorLogger";
import { queryKeys } from "@/lib/queryKeys";
import { queryClient } from "@/lib/queryClient";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { SECTIONS, type SectionKey } from "./sectionsConfig";

/**
 * Which sections a member shows, and in what order (owner, 2026-10-19:
 * "Customize"). Hidden sections leave the bottom nav AND Home. Home and
 * Messages are not sections, so they always show. At least one section stays
 * on: hiding the last one is refused.
 *
 * THE ACCOUNT IS THE SOURCE OF TRUTH (Q2199): the choice is saved on the
 * member's own profile row (profiles.section_order / sections_hidden,
 * migration 20261019074124; RLS own row, never anon), so it follows them to a
 * second device. A device copy, stored per member under "<key>:<userId>"
 * (never one global key: one account's choice must not paint on the next
 * account to sign in), is the offline fallback and what shows while the
 * profile loads; a device copy from before Q2199 is written to the account
 * once (self-heal), so nobody's choice is lost by the move.
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

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** The account's saved choice, or null when the member never chose (both columns NULL, or not deployed yet). */
export function serverPrefs(profile: { section_order?: string[] | null; sections_hidden?: string[] | null } | null | undefined): SectionPrefs | null {
  if (!profile || (profile.section_order == null && profile.sections_hidden == null)) return null;
  return normalizePrefs({ order: profile.section_order ?? [], hidden: profile.sections_hidden ?? [] });
}

type AccountPrefs = { section_order: string[] | null; sections_hidden: string[] | null };
type CachedUser = { profile?: (Record<string, unknown> & Partial<AccountPrefs>) | null } | undefined;

/** Per account: the newest save's number (older in-flight saves stand down), the write chain, and the last value the server confirmed. */
const saveSeq = new Map<string, number>();
const saveChain = new Map<string, Promise<void>>();
const lastConfirmed = new Map<string, AccountPrefs>();

function setCachedPrefs(userId: string, prefs: AccountPrefs) {
  queryClient.setQueryData(queryKeys.currentUser.byId(userId), (old: unknown) => {
    const o = old as CachedUser;
    return o?.profile ? { ...o, profile: { ...o.profile, ...prefs } } : old;
  });
}

/**
 * Write the member's own row, LATEST WINS (code-review 2026-10-19): every save
 * sends the full state, writes run one at a time per account, and a save that a
 * newer one has superseded never sends (or, if already sent, never reports).
 * Optimistic: the profile cache shows the choice at once and rolls back to the
 * last confirmed value if the newest write fails. PGRST204 (the columns are not
 * deployed yet) is quiet: the device copy holds the choice, nothing is reported.
 */
async function writeAccountPrefs(userId: string, next: SectionPrefs): Promise<void> {
  const seq = (saveSeq.get(userId) ?? 0) + 1;
  saveSeq.set(userId, seq);
  if (!lastConfirmed.get(userId)) {
    const cur = (queryClient.getQueryData(queryKeys.currentUser.byId(userId)) as CachedUser)?.profile;
    lastConfirmed.set(userId, { section_order: cur?.section_order ?? null, sections_hidden: cur?.sections_hidden ?? null });
  }
  const value: AccountPrefs = { section_order: next.order, sections_hidden: next.hidden };
  setCachedPrefs(userId, value);
  const run = async () => {
    if (saveSeq.get(userId) !== seq) return; // superseded before it was sent: the newer save carries the full state
    const { data, error } = await supabase.from("profiles").update(value).eq("user_id", userId).select("id");
    if (!error && data && data.length > 0) {
      lastConfirmed.set(userId, value);
      return;
    }
    if (saveSeq.get(userId) !== seq) return; // a newer save is on its way; it decides
    const back = lastConfirmed.get(userId);
    if (back) setCachedPrefs(userId, back);
    if ((error as { code?: string } | null)?.code === "PGRST204") return; // columns not deployed yet: device copy only
    // Never silent: the device copy keeps it on this phone, and the member is told.
    report(error ?? new Error("section prefs update matched 0 rows"), { tags: { source: "useSectionPrefs.saveToAccount" } });
    toast.error("Saved on this device only. We couldn't save it to your account.", { id: "section-prefs-save" });
  };
  const chained = (saveChain.get(userId) ?? Promise.resolve()).then(run, run);
  saveChain.set(userId, chained);
  await chained;
}

/** Accounts whose pre-Q2199 device copy was already offered to the server this session (keyed by user id). */
const healed = new Map<string, true>();

export function useSectionPrefs() {
  const { user, profile } = useCurrentUser();
  const userId = user?.id;
  const device = useSyncExternalStore(subscribe, () => read(userId));
  const serverOrder = profile?.section_order?.join(",") ?? null;
  const serverHidden = profile?.sections_hidden?.join(",") ?? null;
  // Keyed on the two values (as strings), not the profile object, so a profile refetch with the same choice keeps one prefs identity.
  const server = useMemo(
    () => serverPrefs({ section_order: serverOrder === null ? null : serverOrder.split(",").filter(Boolean), sections_hidden: serverHidden === null ? null : serverHidden.split(",").filter(Boolean) }),
    [serverOrder, serverHidden],
  );
  const prefs = server ?? device;

  /** Write the account row (see writeAccountPrefs). */
  const saveToAccount = useCallback((next: SectionPrefs) => (userId ? writeAccountPrefs(userId, next) : Promise.resolve()), [userId]);

  const save = useCallback(
    (next: SectionPrefs) => {
      if (!userId) return;
      const normalized = normalizePrefs(next);
      try {
        safeStorage.setItem(`${KEY}:${userId}`, JSON.stringify(normalized));
      } catch {
        /* best-effort: the account copy below is the one that lasts */
      }
      listeners.forEach((l) => l());
      void saveToAccount(normalized);
    },
    [userId, saveToAccount],
  );

  // Self-heal (Q2199): a choice made before the account column existed lives
  // only on this device. Once the profile is in and says "never chose", write it up.
  useEffect(() => {
    if (!userId || !profile || server || healed.get(userId)) return;
    if (!("section_order" in profile)) return; // column not deployed yet: nothing to heal into
    healed.set(userId, true);
    if (readRaw(userId)) void saveToAccount(device);
  }, [userId, profile, server, device, saveToAccount]);

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
