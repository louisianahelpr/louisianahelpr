/**
 * The gift guides' fun features (owner approved all four in a pop-up, 2026-11-20), the pure parts:
 *   (1) SECRET SANTA: the draw (no one gets themselves, "can't draw" pairs respected) and the reveal link's path;
 *   (2) SWIPE TO FIND GIFTS: who, budget, and the 20-card round from the guide picks;
 *   (3) GIFT PLANNER: the people, budgets, ideas and the money math;
 *   (4) CHRISTMAS COUNTDOWN + GIFT OF THE DAY: the days left (Louisiana time) and one curated pick per day.
 * Every word the four pages show is in FUN_WORDS. Guard: src/test/giftGuideFun1120.test.tsx.
 */
import type { CatalogPick } from "@/content/giftGuideCatalog";
import { FINDER_WHO } from "@/content/giftGuideExtras1120";
import { cleanGiftName } from "@/lib/giftNameClean";
import { fitsBudget, pickCeiling } from "@/content/giftPickBand";

// ---------------------------------------------------------------------------------------------------------------
// Shared: today in Louisiana

/** "YYYY-MM-DD" in Louisiana for a moment. */
export const louisianaYmd = (now: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
/** Whole days from one "YYYY-MM-DD" to another (calendar days, no clock). */
const dayNumber = (ymd: string) => Math.round(Date.parse(`${ymd}T12:00:00Z`) / 86400000);
const daysBetween = (from: string, to: string) => dayNumber(to) - dayNumber(from);

// ---------------------------------------------------------------------------------------------------------------
// (1) Secret Santa

export const SANTA_MIN = 3;
export const SANTA_MAX = 30;
export const SANTA_NAME_MAX = 30;
/** The largest budget a group may set (security review of #4791, item 4; the server checks it too). */
export const SANTA_BUDGET_MAX = 500;
/** The furthest exchange day: a group lives at most 90 days. */
export const SANTA_DAY_MAX_DAYS = 89;

/** A seeded random source (mulberry32), for tests; the page uses Math.random. */
export const seededRandom = (seed: number) => () => {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const shuffled = <T,>(xs: T[], rand: () => number): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/**
 * The draw: givesTo[i] is who person i gives a gift to. Nobody draws themselves, nobody is drawn twice, and no
 * "can't draw" pair is matched either way round. A random backtracking search, so any group that HAS a valid draw
 * gets one (a plain reshuffle can miss a tight one); null when none exists. Capped at 200,000 steps (30 people with a
 * few pairs take well under 100).
 */
export function drawSecretSanta(n: number, avoid: [number, number][] = [], rand: () => number = Math.random): number[] | null {
  if (n < 2) return null;
  const blocked = Array.from({ length: n }, (_, i) => new Set<number>([i]));
  for (const [a, b] of avoid) {
    if (a >= 0 && a < n && b >= 0 && b < n) {
      blocked[a].add(b);
      blocked[b].add(a);
    }
  }
  const givesTo: number[] = new Array(n).fill(-1);
  const taken = new Array(n).fill(false);
  // The most-blocked givers first: they fail fastest, which keeps the search short.
  const order = shuffled([...Array(n).keys()], rand).sort((a, b) => blocked[b].size - blocked[a].size);
  let steps = 0;
  const place = (k: number): boolean => {
    if (k === n) return true;
    const giver = order[k];
    for (const r of shuffled([...Array(n).keys()], rand)) {
      if (++steps > 200000) return false;
      if (taken[r] || blocked[giver].has(r)) continue;
      givesTo[giver] = r;
      taken[r] = true;
      if (place(k + 1)) return true;
      taken[r] = false;
      givesTo[giver] = -1;
    }
    return false;
  };
  return place(0) ? givesTo : null;
}

/** A draw is valid: a permutation of 0..n-1 with no self-match and no "can't draw" pair either way. */
export function drawIsValid(givesTo: number[], avoid: [number, number][] = []): boolean {
  const n = givesTo.length;
  if (new Set(givesTo).size !== n || givesTo.some((r, i) => !Number.isInteger(r) || r < 0 || r >= n || r === i)) return false;
  return avoid.every(([a, b]) => givesTo[a] !== b && givesTo[b] !== a);
}

/** The names as the organizer typed them, cleaned: trimmed, blanks dropped. */
/** A name that reads like a link or an email. */
const LINKISH = /(:\/\/|www\.|@|[a-z0-9-]+\.(com|net|org|ly|io|co|us|info|biz|me|app|link|xyz|gg|tv|site|online|shop)(\b|\/))/i;
/**
 * One typed name, cleaned with the gift guides' shared cleaner (src/lib/giftNameClean.ts: control, zero-width and
 * direction-changing characters dropped, at most SANTA_NAME_MAX characters by code point; security review of #4791,
 * item 4), ends trimmed. secret_santa_create strips the same set on the server.
 */
export const cleanName = (n: string) => cleanGiftName(n, SANTA_NAME_MAX).trim();
/** Why a cleaned name is refused (the server refuses the same), or null. */
export const nameProblem = (n: string): "link" | "phone" | "long" | null =>
  LINKISH.test(n) ? "link" : n.replace(/[^0-9]/g, "").length >= 7 ? "phone" : n.length > SANTA_NAME_MAX ? "long" : null;
/** The names as the organizer typed them, cleaned, blanks dropped. */
export const cleanNames = (names: string[]) => names.map(cleanName).filter(Boolean);
/** The first name typed twice (ignoring case), in the spelling typed first (UX audit L3), or null. */
export const duplicateName = (names: string[]) => {
  const seen = new Map<string, string>();
  for (const n of names) {
    const k = n.toLowerCase();
    const first = seen.get(k);
    if (first !== undefined) return first;
    seen.set(k, n);
  }
  return null;
};

/**
 * The drawer. Not /gift-guides/secret-santa: that is the "Secret Santa & White Elephant" gift guide's own page (and its
 * pins), so the drawer has a path of its own; the reveal links sit under /gift-guides/secret-santa/<code>/<token> (three
 * segments, no clash with the guide).
 */
export const SANTA_PATH = "/gift-guides/draw-names" as const;
/** A person's private reveal link: the group code and their token, never a name. */
export const revealPath = (code: string, token: string) => `/gift-guides/secret-santa/${code}/${token}`;
export const SANTA_CODE = /^[a-f0-9]{10}$/;
export const SANTA_TOKEN = /^[a-f0-9]{64}$/;

// ---------------------------------------------------------------------------------------------------------------
// (2) Swipe to find gifts

export type SwipeWho = "me" | "mom" | "dad" | "her" | "him" | "teen" | "kids" | "friends" | "coworkers" | "louisiana";
export type SwipeBudget = 25 | 50 | 100 | 0;

/**
 * Who: the label and the guides (and sections) the cards come from (the finder's own lists where they exist), and
 * `forName`, the gift planner entry a saved card goes to (owner 11-20: saving for someone else never goes on MY wish
 * list; only "Me" saves to the wish list).
 */
const finderGuides = (id: string) => FINDER_WHO.find((w) => w.id === id)?.guides ?? [];
export const SWIPE_WHO: { id: SwipeWho; label: string; guides: { slug: string; sections?: string[] }[]; forName?: string }[] = [
  { id: "me", label: "Me", guides: [...finderGuides("her"), ...finderGuides("him")] },
  { id: "mom", label: "Mom", guides: finderGuides("mom"), forName: "Mom" },
  { id: "dad", label: "Dad", guides: finderGuides("dad"), forName: "Dad" },
  { id: "her", label: "Her", guides: finderGuides("her"), forName: "Her" },
  { id: "him", label: "Him", guides: finderGuides("him"), forName: "Him" },
  { id: "teen", label: "Teen", guides: finderGuides("teen"), forName: "Teen" },
  { id: "kids", label: "Kids", guides: finderGuides("kids"), forName: "Kids" },
  { id: "friends", label: "Friends", guides: finderGuides("friend"), forName: "Friends" },
  { id: "coworkers", label: "Coworkers", guides: finderGuides("coworker"), forName: "Coworkers" },
  { id: "louisiana", label: "Louisiana", guides: [{ slug: "louisiana-made" }, { slug: "shop-small-louisiana" }, { slug: "louisiana-food-gifts" }], forName: "Louisiana gifts" },
];
export const SWIPE_BUDGETS: { id: SwipeBudget; label: string }[] = [
  { id: 25, label: "Under $25" }, { id: 50, label: "Under $50" }, { id: 100, label: "Under $100" }, { id: 0, label: "Any budget" },
];
export const SWIPE_ROUND = 20;
/** At most this many cards from one store in a round (some variety). */
export const SWIPE_PER_STORE = 5;

/** The picks one "who" draws from: each guide's list in its own order (commission, high to low), guides taking turns. */
export const swipePool = (who: SwipeWho, picksOf: (slug: string) => CatalogPick[]): CatalogPick[] => {
  const w = SWIPE_WHO.find((x) => x.id === who);
  if (!w) return [];
  const lists = w.guides.map((g) => picksOf(g.slug).filter((p) => !g.sections || (p.sectionId !== undefined && g.sections.includes(p.sectionId))));
  const out: CatalogPick[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
};

/**
 * One round: up to 20 cards, strongest first, each link once, at most 5 per store, none already seen this visit. With
 * a budget, the picks known to fit it (a price band at most the budget) come first, then the picks with no band (Amazon
 * allows no price outside its own site, and some shops publish none), never a pick known to cost more (UX audit H3:
 * a band-only round left 0-1 cards for some people and budgets). A light shuffle inside each run of 4 keeps rounds
 * from feeling the same.
 */
export function swipeRound<T extends CatalogPick>(pool: T[], budget: SwipeBudget, seen: ReadonlySet<string>, rand: () => number = Math.random): T[] {
  const fits = (p: CatalogPick) => budget === 0 || (p.band !== undefined && p.band <= budget);
  const unknown = (p: CatalogPick) => budget !== 0 && p.band === undefined;
  const perStore = new Map<string, number>();
  const used = new Set<string>();
  const out: T[] = [];
  for (const p of [...pool.filter(fits), ...pool.filter(unknown)]) {
    if (out.length >= SWIPE_ROUND) break;
    if (!p.href || !p.name || seen.has(p.href) || used.has(p.href)) continue;
    const n = perStore.get(p.store) ?? 0;
    if (n >= SWIPE_PER_STORE) continue;
    perStore.set(p.store, n + 1);
    used.add(p.href);
    out.push(p);
  }
  const mixed: T[] = [];
  for (let i = 0; i < out.length; i += 4) mixed.push(...shuffled(out.slice(i, i + 4), rand));
  return mixed;
}

/** Toys and kids' things: a grown-up's round never borrows them; a kid's borrows only them. */
const KID_THING = /\b(play-?doh|rainbow loom|loomi|melissa (&|and) doug|squish\w*|lincoln logs|barbie|dolls?|plush|play ?sets?|toys?|paint sticks|dive buddies|ms\.? rachel|lego|stacker|kids?'?)\b/i;
/** The guides' men's/women's rules (scripts/giftGuideRules.mjs mensItem, WORK_BOOT_OFF), for picks borrowed from a budget guide. */
const MENS = /\b(men'?s|mens|for men|boys'?|work boots?|steel toe|muckster)\b|^huk$/i;
const WOMENS = /\b(women'?s|womens|ladies|girls'?|lip|gloss|balm|makeup|mascara|blush|nail|mani|earrings|huggies|hoops?|bobby pins|hair|scrunchies?|bows?|eye patches|eye mask|perfume|parfum|tote|racerback|bandana|welly|emi jay|kitsch|summer fridays|tower 28|olive (&|and) june|sol de janeiro|laneige|bareminerals|benefit|kate spade|spartina|gorjana|baublebar|bath (&|and) body works)\b/i;
/** Whether a budget-guide pick suits this "who" (men's/women's, kids). */
export const borrowFits = (who: SwipeWho, p: CatalogPick) => {
  const text = `${p.name} ${p.brand ?? ""}`;
  if (who === "kids") return KID_THING.test(text);
  if (KID_THING.test(text)) return false;
  if (who === "mom" || who === "her") return !MENS.test(p.name) && !MENS.test(p.brand ?? "");
  if (who === "dad" || who === "him") return !WOMENS.test(text);
  return true;
};

/**
 * A Secret Santa round (owner 11-20: "$25 budget and the gift ideas shown were all expensive gifts"): only picks KNOWN
 * to cost at most the group's budget (a checked price, a price band, or a budget section such as "Under $25"; never a
 * pick with no price), the ones closest to the budget first, then a little under, then the rest under. The person's
 * own guides lead each price step; the budget guides' picks that suit them (`borrow`) fill in. Each link once, at most
 * 5 per store, none already seen. A group with no budget (null or 0) gets the ordinary round.
 */
export function santaRound<T extends CatalogPick>(pool: T[], borrow: T[], budget: number | null, seen: ReadonlySet<string>, rand: () => number = Math.random): T[] {
  if (!budget || budget <= 0) return swipeRound(pool, 0, seen, rand);
  const ranked = [...pool.map((p, i) => ({ p, i })), ...borrow.map((p, i) => ({ p, i: pool.length + i }))]
    .filter(({ p }) => fitsBudget(p, budget))
    .sort((a, b) => (pickCeiling(b.p) ?? 0) - (pickCeiling(a.p) ?? 0) || a.i - b.i);
  const perStore = new Map<string, number>();
  const used = new Set<string>();
  const out: T[] = [];
  for (const { p } of ranked) {
    if (out.length >= SWIPE_ROUND) break;
    if (!p.href || !p.name || seen.has(p.href) || used.has(p.href)) continue;
    const n = perStore.get(p.store) ?? 0;
    if (n >= SWIPE_PER_STORE) continue;
    perStore.set(p.store, n + 1);
    used.add(p.href);
    out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// (3) Gift planner

export interface PlanIdea { id: string; name: string; price?: number; bought: boolean; href?: string; guide?: string; item?: string }
export interface PlanPerson { id: string; name: string; budget?: number; ideas: PlanIdea[] }
export interface GiftPlan { people: PlanPerson[]; updatedAt: number }
export const EMPTY_PLAN: GiftPlan = { people: [], updatedAt: 0 };
export const PLAN_MAX_PEOPLE = 50;
export const PLAN_MAX_IDEAS = 30;

const money = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : undefined);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/** A plan read back from storage or the account, cleaned (anything not ours is dropped, never trusted). */
export function cleanPlan(v: unknown): GiftPlan {
  const raw = v as { people?: unknown; updatedAt?: unknown } | null;
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.people)) return EMPTY_PLAN;
  const people = raw.people.slice(0, PLAN_MAX_PEOPLE).flatMap((p): PlanPerson[] => {
    const q = p as Partial<PlanPerson> | null;
    if (!q || typeof q !== "object" || typeof q.id !== "string") return [];
    const ideas = (Array.isArray(q.ideas) ? q.ideas : []).slice(0, PLAN_MAX_IDEAS).flatMap((i): PlanIdea[] => {
      const d = i as Partial<PlanIdea> | null;
      if (!d || typeof d !== "object" || typeof d.id !== "string") return [];
      const price = money(d.price);
      return [{ id: d.id, name: text(d.name, 120), bought: d.bought === true, ...(price !== undefined ? { price } : {}),
        ...(typeof d.href === "string" && /^https:\/\//.test(d.href) ? { href: d.href } : {}),
        ...(typeof d.guide === "string" ? { guide: d.guide } : {}), ...(typeof d.item === "string" ? { item: d.item } : {}) }];
    });
    const budget = money(q.budget);
    return [{ id: q.id, name: text(q.name, 40), ideas, ...(budget !== undefined ? { budget } : {}) }];
  });
  return { people, updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0 };
}

export interface MoneyLine { budget: number; planned: number; spent: number; left: number; over: boolean }
/** One person's money: spent = the bought ideas' prices, planned = every idea's price, left = budget - spent. */
export function personMoney(p: PlanPerson): MoneyLine {
  const sum = (xs: PlanIdea[]) => Math.round(xs.reduce((t, i) => t + (i.price ?? 0), 0) * 100) / 100;
  const spent = sum(p.ideas.filter((i) => i.bought));
  const planned = sum(p.ideas);
  const budget = p.budget ?? 0;
  const left = Math.round((budget - spent) * 100) / 100;
  return { budget, planned, spent, left, over: p.budget !== undefined && spent > p.budget };
}
/** Everyone's money added up (a person with no budget adds nothing to the budget). */
export function planMoney(plan: GiftPlan): MoneyLine & { bought: number; ideas: number } {
  const lines = plan.people.map(personMoney);
  const add = (k: "budget" | "planned" | "spent") => Math.round(lines.reduce((t, l) => t + l[k], 0) * 100) / 100;
  const budget = add("budget");
  const spent = add("spent");
  return { budget, planned: add("planned"), spent, left: Math.round((budget - spent) * 100) / 100, over: budget > 0 && spent > budget,
    bought: plan.people.reduce((t, p) => t + p.ideas.filter((i) => i.bought).length, 0), ideas: plan.people.reduce((t, p) => t + p.ideas.length, 0) };
}
/** "$1,234" or "$12.50". */
export const dollars = (v: number) => `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })}`;
/** A typed amount ("25", "$25.50", "1,000"), or undefined when it is not one. */
export const parseDollars = (s: string): number | undefined => {
  const t = s.replace(/[$,\s]/g, "");
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(t)) return undefined;
  return Number(t);
};

// ---------------------------------------------------------------------------------------------------------------
// (4) Countdown + Gift of the Day

export type Countdown = { kind: "days"; days: number } | { kind: "eve" } | { kind: "today" } | { kind: "after" };
/**
 * Days to Christmas in Louisiana: Dec 24 is "eve", Dec 25 "today", Dec 26-31 "after" (the countdown rests until the
 * new year), and from Jan 1 it counts down to this year's Dec 25.
 */
export function christmasCountdown(now: Date): Countdown {
  const today = louisianaYmd(now);
  const year = today.slice(0, 4);
  const md = today.slice(5);
  if (md === "12-25") return { kind: "today" };
  if (md === "12-24") return { kind: "eve" };
  if (md > "12-25") return { kind: "after" };
  return { kind: "days", days: daysBetween(today, `${year}-12-25`) };
}

/** The 25 Days link shows Dec 1-25 (Louisiana), and only while its flag is on (the lead flips it). */
export const giveawayTieInOn = (now: Date, flagOn: boolean) => {
  const md = louisianaYmd(now).slice(5);
  return flagOn && md >= "12-01" && md <= "12-25";
};

/** The Gift of the Day's price cap (owner 11-20: "The gift of the day shouldn't be expensive"; it was a ~$750 Dyson). */
export const GOTD_MAX_PRICE = 50;
/**
 * The well-known, broadly giftable brands the Gift of the Day may come from (owner 11-20): home, drinkware, cozy and
 * travel names anyone on a list could get, so no pick is aimed at one gender or one age. A pick's brand (or the start
 * of its name) must be one of these.
 */
export const GOTD_BRANDS = ["Stanley", "YETI", "Barefoot Dreams", "Lodge", "Corkcicle", "Bath & Body Works", "Brooklinen", "Away", "Staub", "Jellycat", "XTRATUF", "Hydro Flask", "Owala", "Le Creuset", "Ember"];
/** A name aimed at one gender or a kid ("Women's Muckster", "Boys' ..."): never the Gift of the Day. */
const GOTD_ONE_GROUP = /\b(?:wo)?men'?s\b|\b(?:boy|girl|kid)s?'?(?=\s|$)/i;
const GOTD_BRAND_KEYS = GOTD_BRANDS.map((b) => b.toLowerCase());
const gotdBrandOk = (p: CatalogPick) => {
  const brand = (p.brand ?? "").trim().toLowerCase();
  const name = p.name.toLowerCase();
  return GOTD_BRAND_KEYS.some((b) => brand === b || name.startsWith(`${b} `));
};

/**
 * The picks the Gift of the Day may be: a checked price shown today (`pricedToday`, the page's own PickPrice rule:
 * non-Amazon, fresh) of at most GOTD_MAX_PRICE, from a GOTD_BRANDS brand, not aimed at one group; each link once,
 * in name order (so the day's pick does not depend on which guide's picks arrived first).
 */
export function giftOfTheDayPool(picks: CatalogPick[], pricedToday: (p: CatalogPick) => boolean): CatalogPick[] {
  const seen = new Set<string>();
  return picks
    .filter((p) => p.name && p.href && pricedToday(p) && typeof p.price === "number" && p.price > 0 && p.price <= GOTD_MAX_PRICE && gotdBrandOk(p) && !GOTD_ONE_GROUP.test(p.name))
    .filter((p) => !seen.has(p.href) && Boolean(seen.add(p.href)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The Gift of the Day: one pick from giftOfTheDayPool (owner 11-20: affordable and priced, never a splurge), the
 * same all day for everyone (by the Louisiana date), a different one each day in turn. Null when none qualifies today
 * (the line then shows the countdown alone).
 */
export function giftOfTheDay(picks: CatalogPick[], now: Date, pricedToday: (p: CatalogPick) => boolean): CatalogPick | null {
  const list = giftOfTheDayPool(picks, pricedToday);
  if (!list.length) return null;
  const n = dayNumber(louisianaYmd(now));
  return list[((n % list.length) + list.length) % list.length];
}

// ---------------------------------------------------------------------------------------------------------------
// Words

export const FUN_WORDS = {
  toolsTitle: "Make it fun",
  tools: [
    { to: "/gift-guides/swipe", title: "Swipe to find gifts", body: "Swipe right to save, left to skip." },
    { to: "/gift-guides/draw-names", title: "Secret Santa drawer", body: "Draw names and text each person their match." },
    { to: "/gift-guides/planner", title: "Gift planner", body: "Who's left, what you bought, and your budget." },
    // Owner 11-20 12:30 PM landing plan: the fourth tool card (the printables page, #4811).
    { to: "/gift-guides/printables", title: "Free printables", body: "Gift tags with names, coloring pages and more." },
  ],
  // Countdown + Gift of the Day
  daysLeft: (d: number) => (d === 1 ? "day until Christmas" : "days until Christmas"),
  eve: "Christmas is tomorrow!",
  today: "Merry Christmas!",
  gotdTitle: "Gift of the Day",
  gotdShop: "Shop",
  gotdShare: "Share",
  gotdShareLabel: "Share the Gift of the Day",
  gotdShareText: (name: string) => `Gift of the Day from Louisiana Helpr: ${name}`,
  gotdCopied: "Link copied",
  giveawayOn: "25 Days of Louisiana Giveaways is on",
  // Secret Santa
  santaTitle: "Secret Santa drawer",
  santaLead: "Type everyone's first name. We draw the names, then you send each person a private link to their match.",
  santaNames: "Who's in?",
  santaNamePlaceholder: (n: number) => `Name ${n}`,
  santaAddName: "Add a name",
  santaRemoveName: (name: string) => `Remove ${name || "this name"}`,
  santaBudget: "Budget (optional)",
  santaDate: "Gift exchange day (optional)",
  santaAvoidTitle: "Can't draw each other (optional)",
  santaAvoidHelp: "Like spouses or roommates. A group of 3 can't have a pair (there would be no way to draw).",
  santaPickPerson: "Pick a person",
  santaAvoidAdd: "Add a pair",
  santaAvoidRemove: "Remove pair",
  santaPickA: "First person",
  santaPickB: "Second person",
  santaDraw: "Draw names",
  santaDrawing: "Drawing...",
  santaNeed: (min: number) => `Add at least ${min} names.`,
  santaDup: (name: string) => `${name} is in twice. Add a last initial to tell them apart.`,
  santaImpossible: "Those pairs leave no way to draw. Remove a pair and try again.",
  santaFailed: "We couldn't save the draw. Check your connection and try again.",
  santaRateLimited: "That's a lot of draws in a row. Try again in a little while.",
  santaDoneTitle: "Names drawn!",
  santaDoneLead: "Send each person their own link. Each link shows only that person's match.",
  santaNoPeek: "Don't open other people's links, or you'll spoil the surprise 🎁",
  santaBadName: (name: string) => `"${name}" can't be used. Just a first name, please (no links or phone numbers).`,
  santaBudgetMax: (max: number) => `Pick a budget from $1 to $${max}.`,
  santaSend: (name: string) => `Send to ${name}`,
  santaCopy: "Copy link",
  santaCopied: "Copied",
  santaShareText: (name: string) => `${name}, here's your Secret Santa match. Open it when no one's looking!`,
  santaKeepNote: "Links stop working after the holidays. We don't save emails or phone numbers.",
  santaStartOver: "Start a new group",
  // Reveal
  revealTitle: "Your Secret Santa",
  revealHi: (name: string) => `Hi ${name}! You're getting a gift for`,
  revealBudget: (b: number) => `Budget: $${b}`,
  revealDate: (d: string) => `Exchange: ${d}`,
  revealTheirList: "See their wish list",
  revealLoadFailed: "We couldn't open your match. Check your connection and try again.",
  revealBrowse: "Browse the gift guides",
  revealNoList: (name: string) => `${name} hasn't shared a wish list yet. Check back later, or browse the guides.`,
  revealMyList: "Make your own wish list",
  revealMyListHelp: "Heart gifts in the guides, then share your list so your Secret Santa can see it.",
  revealShareMine: "Share my list with my Santa",
  revealShared: "Your Secret Santa can see your wish list now.",
  revealShareFailed: "We couldn't share your list. Try again.",
  revealEmptyList: "Your wish list is empty. Heart a few gifts first.",
  revealMissing: "This link doesn't work anymore. Ask your organizer for a new one.",
  revealLoading: "Opening your match...",
  revealRetry: "Try again",
  revealFindGifts: "Find a gift for them",
  revealIdeasTitle: (match: string) => `Gift ideas for ${match}`,
  revealIdeasPlanner: "See them in your gift planner",
  // Swipe for a Secret Santa match (owner 11-20: saving for your match never goes on your own wish list)
  santaFinding: (match: string) => `Finding a gift for ${match}`,
  santaWithin: (budget: number) => `Only gifts at or under $${budget}.`,
  santaSavedTitle: (n: number, match: string) => (n === 1 ? `You saved 1 idea for ${match}` : `You saved ${n} ideas for ${match}`),
  santaSavedDevice: "Saved on this device, with your Secret Santa link.",
  santaBack: "Back to your Secret Santa",
  // Swipe
  swipeTitle: "Swipe to find gifts",
  swipeWho: "Who's it for?",
  swipeBudget: "Your budget",
  swipeStart: "Start swiping",
  swipeSave: "Save",
  swipeSkip: "Skip",
  swipeSaveLabel: (name: string) => `Save ${name} to your wish list`,
  swipeSaveFor: (who: string) => `Save for ${who}`,
  swipeSaveForLabel: (name: string, who: string) => `Save ${name} as a gift idea for ${who}`,
  swipeSavedFor: (n: number, who: string) => (n === 1 ? `You saved 1 idea for ${who}` : `You saved ${n} ideas for ${who}`),
  swipeSavedPlanner: "Saved to your gift planner.",
  swipeSkipLabel: (name: string) => `Skip ${name}`,
  swipeDetails: "Details",
  swipeShop: "Shop",
  swipeCount: (i: number, n: number) => `${i} of ${n}`,
  swipeHelp: "Swipe right or tap Save to keep it. Swipe left or tap Skip to pass.",
  swipeDoneTitle: (n: number) => (n === 1 ? "You saved 1 gift" : `You saved ${n} gifts`),
  swipeDoneNone: "Nothing caught your eye? Try another round.",
  swipeMore: "Another round",
  swipeChange: "Change who or budget",
  swipeShare: "Share my wish list",
  swipeShareText: "Here's my wish list on Louisiana Helpr:",
  swipeSeeList: "See my wish list",
  swipeEmpty: "No gifts fit that budget yet. Try another one.",
  swipeLoading: "Loading gifts...",
  swipeLoadFailed: "We couldn't load the gifts. Check your connection and try again.",
  // Planner
  plannerTitle: "Gift planner",
  plannerLead: "Who you're shopping for, your budget, and what you've bought. Only you can see it.",
  plannerSaved: "Saved on this device.",
  plannerSavedAccount: "Saved to your account.",
  plannerSignIn: "Log in to keep it on all your devices.",
  plannerAddPerson: "Add a person",
  plannerPersonName: "Name",
  plannerBudget: "Budget",
  plannerIdeas: "Gift ideas",
  plannerIdeaName: "Gift idea",
  plannerIdeaPrice: "Price",
  plannerAddIdea: "Add idea",
  plannerFromList: "Add from my wish list",
  plannerBought: "Bought",
  plannerRemovePerson: (name: string) => `Remove ${name || "this person"}`,
  plannerRemoveIdea: (name: string) => `Remove ${name || "this idea"}`,
  plannerSpentOf: (spent: string, budget: string) => `${spent} of ${budget}`,
  plannerSpent: (spent: string) => `${spent} spent`,
  plannerLeft: (left: string) => `${left} left`,
  plannerOver: (over: string) => `${over} over`,
  plannerTotals: "Totals",
  plannerTotalBudget: "Budget",
  plannerTotalSpent: "Spent",
  plannerTotalLeft: "Left",
  plannerTotalOver: "Over",
  plannerUnnamed: "Someone",
  plannerTotalBought: (b: number, n: number) => `${b} of ${n} ${n === 1 ? "gift" : "gifts"} bought`,
  plannerEmpty: "Add the first person you're shopping for.",
  plannerFindGifts: "Find gift ideas",
  plannerBadAmount: "Type an amount like 25 or 25.50.",
  // One-time tips (the wish-list hints)
  hintSwipe: "Tip: drag a card right to save it, left to skip. Or use the buttons.",
  hintSanta: "Tip: we never ask for emails or phone numbers. You send each link yourself.",
  hintPlanner: "Tip: tap Bought when you get a gift, and we'll add up what you've spent.",
};
