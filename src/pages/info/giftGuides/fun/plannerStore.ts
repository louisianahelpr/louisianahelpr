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
/** `removed`: ids of people and ideas removed on this device since the last account sync (audit 1121 High: the merge
 *  keeps this device's removals instead of bringing them back from the account). */
interface DeviceCopy { ownerId: string | null; plan: GiftPlan; removed?: string[] }
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
    else {
      const gone = (v as { removed?: unknown }).removed;
      stored = { ownerId: typeof v.ownerId === "string" ? v.ownerId : null, plan: cleanPlan(v.plan), ...(Array.isArray(gone) ? { removed: gone.filter((x): x is string => typeof x === "string").slice(-500) } : {}) };
    }
  } catch {
    // Storage blocked or the saved value is not ours: an empty planner for this visit.
    stored = NOBODY;
  }
  return stored;
}

/** Whether this copy may be shown to (and merged into) this viewer: a signed-out draft, or the viewer's own. */
const copyBelongsTo = (ownerId: string | null, who: string | null) => ownerId === null || ownerId === who;

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

/** A change made by the viewer: stamped, and tagged as theirs. `gone`: ids it removes (kept for the next account merge). */
function write(next: GiftPlan, gone: string[] = []) {
  // Anything back in the plan (an Undo) is no longer removed.
  const present = new Set(next.people.flatMap((p) => [p.id, ...p.ideas.map((i) => i.id)]));
  const removed = [...(readCopy().removed ?? []), ...gone].filter((id) => !present.has(id)).slice(-500);
  save({ ownerId: viewer ?? null, plan: { ...next, updatedAt: Date.now() }, ...(removed.length ? { removed } : {}) });
}

/**
 * The account's plan and this device's, brought together by id (audit 1121 High: "newest wins" replaced a 5-person
 * account plan with a newer 1-person phone draft). Every person and idea either side holds is kept, except what this
 * device removed since the last sync (`removed`); where both hold the same person or idea, the newer plan's version
 * wins (people keep the newer plan's order, then the others). Ideas are merged the same way inside each person. At
 * most PLAN_MAX_PEOPLE people and PLAN_MAX_IDEAS ideas each.
 */
export function mergePlans(remote: GiftPlan, local: GiftPlan, removed: readonly string[] = []): GiftPlan {
  const gone = new Set(removed);
  const localNewer = local.updatedAt >= remote.updatedAt;
  const [first, second] = localNewer ? [local, remote] : [remote, local];
  const byId = <T extends { id: string }>(a: T[], b: T[], merge: (x: T, y: T) => T, cap: number): T[] => {
    const out: T[] = [];
    const seen = new Set<string>();
    for (const x of [...a, ...b]) {
      if (seen.has(x.id) || gone.has(x.id)) continue;
      seen.add(x.id);
      const y = b.find((z) => z.id === x.id);
      out.push(y && y !== x ? merge(x, y) : x);
    }
    return out.slice(0, cap);
  };
  const people = byId(first.people, second.people, (a, b) => ({ ...a, ideas: byId(a.ideas, b.ideas, (x) => x, PLAN_MAX_IDEAS) }), PLAN_MAX_PEOPLE);
  return { people, updatedAt: Math.max(remote.updatedAt, local.updatedAt) };
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
/** The plan as the viewer may see it now, outside React (a Secret Santa idea saved from the swipe page). */
export const readPlanForSanta = (): GiftPlan => read();

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

// Writes only when the person is there and something changed (lh-silent-failure review: a late answer for a person or
// idea that is gone, or a viewer who signed out meanwhile, must not stamp a new, emptier plan).
const mapPerson = (id: string, f: (p: PlanPerson) => PlanPerson) => {
  const cur = read();
  let changed = false;
  const people = cur.people.map((p) => {
    if (p.id !== id) return p;
    const next = f(p);
    if (next !== p) changed = true;
    return next;
  });
  if (changed) write({ ...cur, people });
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
    const gone = cur.people.find((p) => p.id === id);
    if (!gone) return;
    write({ ...cur, people: cur.people.filter((p) => p.id !== id) }, [id, ...gone.ideas.map((i) => i.id)]);
  },
  // The new idea goes through cleanPlan's own rules too (an href only when it is https://). Its id, or null when the
  // person is gone or their list is full.
  addIdea(personId: string, idea: Omit<PlanIdea, "id" | "bought">): string | null {
    const id = newId();
    let added = false;
    mapPerson(personId, (p) => {
      if (p.ideas.length >= PLAN_MAX_IDEAS) return p;
      added = true;
      return cleanPlan({ people: [{ ...p, ideas: [...p.ideas, { ...idea, id, bought: false }] }] }).people[0] ?? p;
    });
    return added ? id : null;
  },
  /**
   * What the server said about the link requests we asked about (owner 11-21, wish_link_requests): `found` holds each
   * request that still exists, with our link once made (else null). A gift whose request has our link now uses it; a
   * gift whose request is gone (pruned) forgets it, so a share no longer carries it.
   */
  applyOurLinks(asked: readonly string[], found: ReadonlyMap<string, string | null>) {
    const ask = new Set(asked);
    const cur = read();
    let changed = false;
    const people = cur.people.map((p) => ({
      ...p, ideas: p.ideas.map((i) => {
        if (!i.req || !ask.has(i.req)) return i;
        if (!found.has(i.req)) {
          changed = true;
          const rest = { ...i };
          delete rest.req;
          return rest;
        }
        const link = found.get(i.req);
        if (!link || link === i.href) return i;
        changed = true;
        return { ...i, href: link };
      }),
    }));
    if (changed) write({ ...cur, people });
  },
  // A patch key set to undefined removes it (a price cleared, a request's `ask` once answered). No write when the idea
  // is gone.
  setIdea: (personId: string, ideaId: string, patch: Partial<Omit<PlanIdea, "id">>) => mapPerson(personId, (p) => {
    if (!p.ideas.some((i) => i.id === ideaId)) return p;
    return {
      ...p, ideas: p.ideas.map((i) => {
        if (i.id !== ideaId) return i;
        const next: Record<string, unknown> = { ...i, ...patch };
        for (const k of Object.keys(patch)) if (next[k] === undefined) delete next[k];
        return next as unknown as PlanIdea;
      }),
    };
  }),
  removeIdea(personId: string, ideaId: string) {
    const cur = read();
    const p = cur.people.find((x) => x.id === personId);
    if (!p || !p.ideas.some((i) => i.id === ideaId)) return;
    write({ ...cur, people: cur.people.map((x) => (x === p ? { ...x, ideas: x.ideas.filter((i) => i.id !== ideaId) } : x)) }, [ideaId]);
  },
  /** Undo removing a person (holiday audit 1121): they come back where they were, with their gifts and budget. */
  restorePerson(person: PlanPerson, index: number) {
    const cur = read();
    if (cur.people.some((p) => p.id === person.id) || cur.people.length >= PLAN_MAX_PEOPLE) return;
    const at = Math.max(0, Math.min(index, cur.people.length));
    write({ ...cur, people: [...cur.people.slice(0, at), person, ...cur.people.slice(at)] });
  },
  /** Undo a removal (owner 11-21, "Removed · Undo"): the idea goes back where it was, unless the list filled up meanwhile. */
  restoreIdea: (personId: string, idea: PlanIdea, index: number) => mapPerson(personId, (p) => {
    if (p.ideas.some((i) => i.id === idea.id) || p.ideas.length >= PLAN_MAX_IDEAS) return p;
    const at = Math.max(0, Math.min(index, p.ideas.length));
    return { ...p, ideas: [...p.ideas.slice(0, at), idea, ...p.ideas.slice(at)] };
  }),
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
        const mine = copyBelongsTo(c.ownerId, userId);
        const local = mine ? c.plan : EMPTY_PLAN;
        // Audit 1121 High: merged by id (both sides' people and ideas kept, this device's removals kept), never one
        // copy replacing the other.
        const take = remote ? mergePlans(remote, local, mine ? c.removed ?? [] : []) : local;
        save({ ownerId: userId, plan: take });
        ready.current = userId;
        setState("account");
        // Anything this device adds or removes goes up to the account (it already holds the rest).
        if (take.people.length > 0 && JSON.stringify(take.people) !== JSON.stringify(remote?.people ?? [])) saveAccountPlan(userId, take).catch((e: unknown) => {
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
