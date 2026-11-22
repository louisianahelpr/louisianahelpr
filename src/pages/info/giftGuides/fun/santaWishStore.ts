import { useSyncExternalStore } from "react";
import { PLAN_MAX_IDEAS, cleanPlan, type PlanIdea, type PlanPerson } from "@/content/giftGuideFun1120";
import type { IdeaActions } from "../AnyStoreAdd";
import type { LinkWriter } from "../wishLinkSync";

/**
 * A Secret Santa participant's own wish list (owner 2026-11-21: "the person should list what they want from their
 * Secret Santa; once they have their list we create the links"). One list per group, kept on this device only
 * (localStorage "lh-santa-wish", { [group code]: PlanPerson }), every read and write in try/catch. Its id is a random
 * list key (what wish_link_requests groups by); the reveal token is never stored here or sent with it.
 * The list reaches the person's Secret Santa only when they send it (gift_wish_lists_share + secret_santa_set_wish_list,
 * SantaWishList.tsx). Guard: src/test/santaWishList1121.test.tsx.
 */
const KEY = "lh-santa-wish";
type Lists = Record<string, PlanPerson>;
let lists: Lists | null = null;
const listeners = new Set<() => void>();
/** A list key: the group code and the person's own first name, lower case (names in a group are never repeated), so two
 *  people of one group on one shared device never see each other's list (lh-authz-rls review). */
const GROUP = /^[a-f0-9]{10}:[^\n]{1,30}$/;
export const santaKey = (code: string, me: string) => `${code}:${me.trim().toLowerCase().slice(0, 30)}`;

function readAll(): Lists {
  if (lists) return lists;
  try {
    const raw = window.localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    const out: Lists = {};
    if (v && typeof v === "object") {
      for (const [code, p] of Object.entries(v as Record<string, unknown>)) {
        // Each list is cleaned by the planner's own rules (links https only, request ids only when real).
        const person = GROUP.test(code) ? cleanPlan({ people: [p] }).people[0] : undefined;
        if (person) out[code] = person;
      }
    }
    lists = out;
  } catch {
    // Storage blocked or not ours: an empty list for this visit.
    lists = {};
  }
  return lists;
}

function save(next: Lists) {
  lists = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage blocked (private window, full): the list still works for this visit, in memory.
  }
  listeners.forEach((l) => l());
}

const newId = () => Math.random().toString(36).slice(2, 10);
const EMPTY: PlanIdea[] = [];

// A group's list before its first gift: one per group and name for the visit, so the id the page shows is the id saved.
const empties = new Map<string, PlanPerson>();
const stableEmpty = (code: string, name: string) => {
  const k = `${code} ${name}`;
  if (!empties.has(k)) empties.set(k, { id: `s${newId()}${newId()}`.slice(0, 16), name: name.slice(0, 40), ideas: EMPTY });
  return empties.get(k)!;
};

/** This group's list for the person (empty, named after them, until its first gift). */
function listFor(code: string, name: string): PlanPerson {
  return readAll()[code] ?? stableEmpty(code, name);
}

// Writes only when something changed (a late answer for a gift that is gone writes nothing).
function update(code: string, name: string, f: (p: PlanPerson) => PlanPerson) {
  const cur = readAll();
  const before = listFor(code, name);
  const next = f(before);
  if (next !== before) save({ ...cur, [code]: next });
}

// What was last sent to the person's Secret Santa (the share's refs), per group: "Send the update" shows when it differs.
const SENT_KEY = "lh-santa-wish-sent";
let sent: Record<string, string> | null = null;
function readSent(): Record<string, string> {
  if (sent) return sent;
  try {
    const v = JSON.parse(window.localStorage.getItem(SENT_KEY) ?? "{}") as unknown;
    sent = v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k, s]) => GROUP.test(k) && typeof s === "string").map(([k, s]) => [k, String(s).slice(0, 20000)])) : {};
  } catch {
    // Storage blocked or not ours: nothing sent yet, as far as this visit knows.
    sent = {};
  }
  return sent;
}
/** The refs last sent for this group, or null. */
export const useSentSignature = (code: string): string | null =>
  useSyncExternalStore(subscribe, () => readSent()[code] ?? null, () => null);
export function markSent(code: string, signature: string) {
  sent = { ...readSent(), [code]: signature };
  try {
    window.localStorage.setItem(SENT_KEY, JSON.stringify(sent));
  } catch {
    // Storage blocked: "Sent" lasts this visit.
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** The person's list for this group (stable between renders until it changes). */
export function useSantaWish(code: string, name: string): PlanPerson {
  const all = useSyncExternalStore(subscribe, readAll, () => ({}) as Lists);
  return all[code] ?? stableEmpty(code, name);
}

/** The actions AnyStoreAdd, the link sync and the list's own rows use on this group's list. */
export function santaWishActions(code: string, name: string): IdeaActions & LinkWriter & { removeIdea: (personId: string, ideaId: string) => void } {
  return {
    applyOurLinks(asked, found) {
      const ask = new Set(asked);
      update(code, name, (p) => {
        let changed = false;
        const ideas = p.ideas.map((i) => {
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
        });
        return changed ? { ...p, ideas } : p;
      });
    },
    addIdea(_personId, idea) {
      const id = newId();
      let added = false;
      update(code, name, (p) => {
        if (p.ideas.length >= PLAN_MAX_IDEAS) return p;
        added = true;
        return cleanPlan({ people: [{ ...p, ideas: [...p.ideas, { ...idea, id, bought: false }] }] }).people[0] ?? p;
      });
      return added ? id : null;
    },
    setIdea(_personId, ideaId, patch) {
      update(code, name, (p) => {
        if (!p.ideas.some((i) => i.id === ideaId)) return p;
        return {
          ...p, ideas: p.ideas.map((i) => {
            if (i.id !== ideaId) return i;
            const next: Record<string, unknown> = { ...i, ...patch };
            for (const k of Object.keys(patch)) if (next[k] === undefined) delete next[k];
            return next as unknown as PlanIdea;
          }),
        };
      });
    },
    removeIdea(_personId, ideaId) {
      update(code, name, (p) => ({ ...p, ideas: p.ideas.filter((i) => i.id !== ideaId) }));
    },
  };
}

/** For tests: forget the in-memory copy. */
export const resetSantaWishForTests = () => {
  lists = null;
  sent = null;
  empties.clear();
};
