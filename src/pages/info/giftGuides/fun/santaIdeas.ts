import { useSyncExternalStore } from "react";
import type { CatalogPick } from "@/content/giftGuideCatalog";
import { planActions, readPlanForSanta } from "./plannerStore";

/**
 * Gift ideas for a Secret Santa match (owner 11-20: "it also saved the gifts i save for my secret santa to my wish
 * list. thats not my wish list"). The wish list is what I want; ideas for my match go to a "Gift ideas for <match>"
 * list instead: signed in, the match's entry in the gift planner (made if missing, with the group's budget); signed
 * out, this device, kept with that Secret Santa (localStorage "lh-santa-ideas", by group code; every read and write in
 * try/catch, so blocked storage means ideas that last the visit). Guard: src/test/secretSantaIdeas1120.test.tsx.
 */

/** Who the swipe page is finding a gift for, handed over by the reveal page (router state; the URL holds nothing). */
export interface SantaFor { code: string; match: string; budget: number | null; back: string }
export interface SantaIdea { name: string; href: string; guide?: string }

export const SANTA_IDEAS_KEY = "lh-santa-ideas";
const MAX_IDEAS = 30;
type Store = Record<string, { match: string; ideas: SantaIdea[] }>;

let store: Store | null = null;
const listeners = new Set<() => void>();
const EMPTY: SantaIdea[] = [];

function read(): Store {
  if (store) return store;
  try {
    const v = JSON.parse(window.localStorage.getItem(SANTA_IDEAS_KEY) ?? "{}") as unknown;
    store = v && typeof v === "object" && !Array.isArray(v) ? (v as Store) : {};
  } catch {
    // Blocked storage or a value that is not ours: start empty for this visit.
    store = {};
  }
  return store;
}

function write(next: Store) {
  store = next;
  try {
    window.localStorage.setItem(SANTA_IDEAS_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked (private window, full): the ideas still last this visit, in memory.
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** The ideas kept on this device for one Secret Santa group (the reveal page lists them). */
export const santaIdeasOnDevice = (code: string): SantaIdea[] => {
  const ideas = read()[code]?.ideas;
  return Array.isArray(ideas) ? ideas.filter((i) => i && typeof i.name === "string" && typeof i.href === "string" && /^https:\/\//.test(i.href)) : EMPTY;
};
export const useSantaIdeas = (code: string): SantaIdea[] => {
  const ideas = useSyncExternalStore(subscribe, () => read()[code]?.ideas, () => undefined);
  return ideas ? santaIdeasOnDevice(code) : EMPTY;
};

/** For tests: forget the in-memory copy. */
export const resetSantaIdeasForTests = () => {
  store = null;
};

/**
 * Save a card as a gift idea for the match. `toPlanner` (signed in and the planner loaded from the account): into the
 * planner, under the match's name; otherwise onto this device with the Secret Santa. Never the wish list. Returns
 * where it went, or "full".
 */
export function saveSantaIdea(santa: SantaFor, card: CatalogPick & { guide?: string }, toPlanner: boolean): "planner" | "device" | "full" {
  const idea: SantaIdea = { name: card.name, href: card.href, ...(card.guide ? { guide: card.guide } : {}) };
  if (toPlanner) {
    const want = santa.match.trim().toLowerCase();
    let person = readPlanForSanta().people.find((p) => p.name.trim().toLowerCase() === want);
    if (!person) {
      const id = planActions.addPerson(santa.match);
      if (id && santa.budget) planActions.setBudget(id, santa.budget);
      person = id ? readPlanForSanta().people.find((p) => p.id === id) : undefined;
    }
    if (person) {
      if (!person.ideas.some((i) => i.href === idea.href)) {
        // A checked price goes with it (the planner adds up spending); never an Amazon price.
        const price = card.price !== undefined && card.store !== "amazon" ? card.price : undefined;
        planActions.addIdea(person.id, { name: idea.name, href: idea.href, ...(idea.guide ? { guide: idea.guide } : {}), ...(price !== undefined ? { price } : {}) });
      }
      return "planner";
    }
    // The planner is full (50 people): keep the idea on this device instead.
  }
  const cur = read();
  const mine = cur[santa.code] ?? { match: santa.match, ideas: [] };
  if (mine.ideas.some((i) => i.href === idea.href)) return "device";
  if (mine.ideas.length >= MAX_IDEAS) return "full";
  write({ ...cur, [santa.code]: { match: santa.match, ideas: [...mine.ideas, idea] } });
  return "device";
}

/** The reveal page's hand-over to the swipe page: router state only (the reveal's token never enters a URL). */
export const readSantaFor = (state: unknown): SantaFor | null => {
  const s = (state as { santa?: Partial<SantaFor> } | null)?.santa;
  if (!s || typeof s.code !== "string" || typeof s.match !== "string" || !s.match.trim() || typeof s.back !== "string" || !s.back.startsWith("/gift-guides/secret-santa/")) return null;
  const budget = typeof s.budget === "number" && Number.isFinite(s.budget) && s.budget > 0 ? s.budget : null;
  return { code: s.code, match: s.match.slice(0, 40), budget, back: s.back };
};
