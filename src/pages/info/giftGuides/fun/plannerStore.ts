import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { EMPTY_PLAN, PLAN_MAX_IDEAS, PLAN_MAX_PEOPLE, cleanPlan, type GiftPlan, type PlanIdea, type PlanPerson } from "@/content/giftGuideFun1120";
import { loadAccountPlan, saveAccountPlan } from "@/lib/giftGuideFunApi";
import { PLANNER_KEY, onPlannerCleared } from "@/lib/giftPlannerDevice";

/**
 * The gift planner's store (owner 2026-11-20): kept on this device (localStorage "lh-gift-planner", every read and
 * write in try/catch: blocked storage means a planner that lasts the visit) and, signed in, on the account
 * (gift_planner_plans, own row by RLS). Private: nothing here is ever shared.
 *
 * Shared devices (security review of #4791, item 1): the device copy carries the id of the account it belongs to
 * (`ownerId`; null = made signed out). A copy that belongs to another account is never shown and never uploaded: the
 * next person sees an empty planner, and on sign-in only a signed-out draft or the same account's copy is merged (the
 * newer of it and the account's wins). Sign-out removes the device copy altogether (clearPlannerDevice, called by
 * src/lib/authSignOut.ts).
 */
interface DeviceCopy { ownerId: string | null; plan: GiftPlan }
const NOBODY: DeviceCopy = { ownerId: null, plan: EMPTY_PLAN };
let stored: DeviceCopy = NOBODY;
let loaded = false;
/** Who is looking: an account id, null when signed out, undefined until sign-in state is known. */
let viewer: string | null | undefined;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function readCopy(): DeviceCopy {
  if (loaded) return stored;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(PLANNER_KEY);
    const v = raw ? (JSON.parse(raw) as { ownerId?: unknown; plan?: unknown; people?: unknown }) : null;
    if (!v || typeof v !== "object") stored = NOBODY;
    // A copy saved before owner tags: no owner known, so it counts as a signed-out draft.
    else if ("people" in v) stored = { ownerId: null, plan: cleanPlan(v) };
    else stored = { ownerId: typeof v.ownerId === "string" ? v.ownerId : null, plan: cleanPlan(v.plan) };
  } catch {
    // Storage blocked or the saved value is not ours: an empty planner for this visit.
    stored = NOBODY;
  }
  return stored;
}

/** Whether this copy may be shown to (and merged into) this viewer: a signed-out draft, or the viewer's own. */
export const copyBelongsTo = (ownerId: string | null, who: string | null) => ownerId === null || ownerId === who;

/** The plan the viewer may see: nothing until sign-in state is known, nothing that belongs to someone else. */
function read(): GiftPlan {
  const c = readCopy();
  if (viewer === undefined || !copyBelongsTo(c.ownerId, viewer)) return EMPTY_PLAN;
  return c.plan;
}

function save(next: DeviceCopy) {
  stored = next;
  try {
    window.localStorage.setItem(PLANNER_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked (private window, full): the planner still works for this visit, in memory.
  }
  notify();
}

/** A change made by the viewer: stamped, and tagged as theirs. */
function write(next: GiftPlan) {
  save({ ownerId: viewer ?? null, plan: { ...next, updatedAt: Date.now() } });
}

onPlannerCleared(() => {
  stored = NOBODY;
  loaded = true;
  notify();
});

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export const usePlan = (): GiftPlan => useSyncExternalStore(subscribe, read, () => EMPTY_PLAN);

/** Set who is looking (the page calls it from the auth state). */
export function setPlanViewer(who: string | null | undefined) {
  if (viewer === who) return;
  viewer = who;
  notify();
}

/** For tests: forget the in-memory copy and the viewer. */
export const resetPlanStoreForTests = () => {
  stored = NOBODY;
  loaded = false;
  viewer = undefined;
};

/** A short random id for a person or an idea (only ever inside the planner). */
const newId = () => Math.random().toString(36).slice(2, 10);

const mapPerson = (id: string, f: (p: PlanPerson) => PlanPerson) => {
  const cur = read();
  write({ ...cur, people: cur.people.map((p) => (p.id === id ? f(p) : p)) });
};

export const planActions = {
  addPerson(name: string): string | null {
    const cur = read();
    if (cur.people.length >= PLAN_MAX_PEOPLE) return null;
    const id = newId();
    write({ ...cur, people: [...cur.people, { id, name: name.slice(0, 40), ideas: [] }] });
    return id;
  },
  renamePerson: (id: string, name: string) => mapPerson(id, (p) => ({ ...p, name: name.slice(0, 40) })),
  setBudget: (id: string, budget: number | undefined) => mapPerson(id, (p) => {
    const next = { ...p, budget };
    if (budget === undefined) delete next.budget;
    return next;
  }),
  removePerson(id: string) {
    const cur = read();
    write({ ...cur, people: cur.people.filter((p) => p.id !== id) });
  },
  // The new idea goes through cleanPlan's own rules too (an href only when it is https://).
  addIdea: (personId: string, idea: Omit<PlanIdea, "id" | "bought">) => mapPerson(personId, (p) =>
    p.ideas.length >= PLAN_MAX_IDEAS ? p : cleanPlan({ people: [{ ...p, ideas: [...p.ideas, { ...idea, id: newId(), bought: false }] }] }).people[0] ?? p),
  setIdea: (personId: string, ideaId: string, patch: Partial<Omit<PlanIdea, "id">>) => mapPerson(personId, (p) => ({
    ...p, ideas: p.ideas.map((i) => {
      if (i.id !== ideaId) return i;
      const next = { ...i, ...patch };
      if ("price" in patch && patch.price === undefined) delete next.price;
      return next;
    }),
  })),
  removeIdea: (personId: string, ideaId: string) => mapPerson(personId, (p) => ({ ...p, ideas: p.ideas.filter((i) => i.id !== ideaId) })),
};

export type SyncState = "device" | "account" | "error";

/**
 * Signed in: load the account copy once and merge it with the device copy (only a signed-out draft or this account's
 * own: another account's copy is dropped, never uploaded), then save each change after 800 ms. Returns where the
 * planner is saved, for the page's one-line note. `authReady` false keeps the planner hidden until the sign-in state
 * is known.
 */
export function useAccountSync(userId: string | null, authReady: boolean): SyncState {
  const plan = usePlan();
  const [state, setState] = useState<SyncState>("device");
  const ready = useRef<string | null>(null);
  useEffect(() => {
    setPlanViewer(authReady ? userId : undefined);
  }, [userId, authReady]);
  useEffect(() => {
    ready.current = null;
    if (!authReady || !userId) {
      setState("device");
      return;
    }
    let live = true;
    loadAccountPlan(userId).then(
      (remote) => {
        if (!live) return;
        const c = readCopy();
        // Another account's copy left on this device: never merged, never uploaded.
        const local = copyBelongsTo(c.ownerId, userId) ? c.plan : EMPTY_PLAN;
        const take = remote && remote.updatedAt > local.updatedAt ? remote : local;
        save({ ownerId: userId, plan: take });
        ready.current = userId;
        setState("account");
        // This account's device copy (or its signed-out draft) is newer, or the account has none yet: push it up.
        if (take === local && local.people.length > 0 && (!remote || remote.updatedAt < local.updatedAt)) saveAccountPlan(userId, local).catch((e: unknown) => {
          console.warn("gift planner: first save failed", e);
          if (live) setState("error");
        });
      },
      (e: unknown) => {
        // Could not read the account copy: keep the device copy (shown only if it is this account's) on the device.
        console.warn("gift planner: load failed", e);
        if (live) setState("error");
      },
    );
    return () => {
      live = false;
    };
  }, [userId, authReady]);
  useEffect(() => {
    if (!userId || ready.current !== userId) return;
    const t = window.setTimeout(() => {
      saveAccountPlan(userId, plan).then(
        () => setState("account"),
        (e: unknown) => {
          console.warn("gift planner: save failed", e);
          setState("error");
        },
      );
    }, 800);
    return () => window.clearTimeout(t);
  }, [plan, userId]);
  return state;
}
