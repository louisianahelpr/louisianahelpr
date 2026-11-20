import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { EMPTY_PLAN, PLAN_MAX_IDEAS, PLAN_MAX_PEOPLE, cleanPlan, type GiftPlan, type PlanIdea, type PlanPerson } from "@/content/giftGuideFun1120";
import { loadAccountPlan, saveAccountPlan } from "@/lib/giftGuideFunApi";

/**
 * The gift planner's store (owner 2026-11-20): kept on this device (localStorage "lh-gift-planner", every read and
 * write in try/catch: blocked storage means a planner that lasts the visit) and, signed in, on the account
 * (gift_planner_plans, own row by RLS). On sign-in the newer of the two wins (updatedAt); after that every change is
 * saved to the account a moment later. Private: nothing here is ever shared.
 */
const KEY = "lh-gift-planner";
let memory: GiftPlan = EMPTY_PLAN;
let loaded = false;
const listeners = new Set<() => void>();

function read(): GiftPlan {
  if (loaded) return memory;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    memory = raw ? cleanPlan(JSON.parse(raw)) : EMPTY_PLAN;
  } catch {
    // Storage blocked or the saved value is not ours: an empty planner for this visit.
    memory = EMPTY_PLAN;
  }
  return memory;
}

function write(next: GiftPlan, stamp = true) {
  memory = stamp ? { ...next, updatedAt: Date.now() } : next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    // Storage blocked (private window, full): the planner still works for this visit, in memory.
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export const usePlan = (): GiftPlan => useSyncExternalStore(subscribe, read, () => EMPTY_PLAN);


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
    const { budget: _old, ...rest } = p;
    return budget === undefined ? rest : { ...rest, budget };
  }),
  removePerson(id: string) {
    const cur = read();
    write({ ...cur, people: cur.people.filter((p) => p.id !== id) });
  },
  addIdea: (personId: string, idea: Omit<PlanIdea, "id" | "bought">) => mapPerson(personId, (p) =>
    p.ideas.length >= PLAN_MAX_IDEAS ? p : { ...p, ideas: [...p.ideas, { ...idea, name: idea.name.slice(0, 120), id: newId(), bought: false }] }),
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
 * Signed in: load the account copy once (the newer of the two wins), then save each change after 800 ms. Returns
 * where the planner is saved, for the page's one-line note.
 */
export function useAccountSync(userId: string | null): SyncState {
  const plan = usePlan();
  const [state, setState] = useState<SyncState>("device");
  const ready = useRef<string | null>(null);
  useEffect(() => {
    ready.current = null;
    if (!userId) {
      setState("device");
      return;
    }
    let live = true;
    loadAccountPlan(userId).then(
      (remote) => {
        if (!live) return;
        const local = read();
        if (remote && remote.updatedAt > local.updatedAt) write(remote, false);
        ready.current = userId;
        setState("account");
        // The device copy is newer (or the account has none): push it up.
        if (!remote || remote.updatedAt < local.updatedAt) saveAccountPlan(userId, read()).catch((e: unknown) => {
          console.warn("gift planner: first save failed", e);
          if (live) setState("error");
        });
      },
      (e: unknown) => {
        // Could not read the account copy: keep the device copy and say it is saved on this device only.
        console.warn("gift planner: load failed", e);
        if (live) setState("error");
      },
    );
    return () => {
      live = false;
    };
  }, [userId]);
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

/** For tests: forget the in-memory copy so the next read goes back to storage. */
export const resetPlanForTests = () => {
  loaded = false;
  memory = EMPTY_PLAN;
};
