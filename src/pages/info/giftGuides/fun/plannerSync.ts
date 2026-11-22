import { useEffect, useRef, useState } from "react";
import { EMPTY_PLAN, PLAN_MAX_PEOPLE, PLAN_MAX_IDEAS, type GiftPlan, type PlanPerson } from "@/content/giftGuideFun1120";
import { loadAccountPlan, saveAccountPlan } from "@/lib/giftGuideFunApi";
import { copyBelongsTo, read, readCopy, save, setPlanViewer, usePlan, write } from "./plannerStore";

/**
 * The gift planner's account sync and Undo for a removed person, apart from plannerStore.ts so that no guide page
 * downloads them: only the lazy Save for someone sheet and the fun pages (planner, swipe) import this module (lander3,
 * train 1121i: /gift-guides/:slug was over its critical-path budget). The store itself stays where every guide page
 * reads it.
 */
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

/** Undo removing a person (holiday audit 1121): they come back where they were, with their gifts and budget. */
export function restorePerson(person: PlanPerson, index: number) {
  const cur = read();
  if (cur.people.some((p) => p.id === person.id) || cur.people.length >= PLAN_MAX_PEOPLE) return;
  const at = Math.max(0, Math.min(index, cur.people.length));
  write({ ...cur, people: [...cur.people.slice(0, at), person, ...cur.people.slice(at)] });
}

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
