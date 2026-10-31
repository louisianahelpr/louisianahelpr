/**
 * Saved searches for every section (Q2275, board 91). One table,
 * public.saved_searches (migration 20261021042132): a `section`, the filters
 * (query, category, min/max_budget in whole dollars, radius_miles), the row's
 * own on/off (`notify_enabled`, in the app), the email channel
 * (`notify_email`, at most once a day and only when something new matched) and
 * `last_seen_at`, from which saved_search_new_counts() counts "N new".
 *
 * Text messages are not a channel: there is no text-alert sender yet (board
 * 88), so nothing here offers one (truth rule).
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { mutationErrorMessage, unwrapMutation } from "@/lib/mutationResult";
import { isMissingRpcNamed } from "@/lib/missingRpc";
// JOB_CATEGORY_LABELS straight from its source (activityConstants re-exports it as categoryLabels): importing
// activityConstants from a src/lib module pulled that 16.7 KB module into app-shared, on every page's boot path
// (/login 284 -> 286 KB gz, over the Q178 budget; TRAIN A, 2026-10-21).
import { JOB_CATEGORY_LABELS } from "@/lib/jobCategories";
import { CATEGORY_LABEL } from "@/lib/declutter/categoryIcons";

/** The sections a member can save a search in today (Shops and Homes open later). */
export type SavedSearchSection = "jobs" | "declutter";

export const SECTION_LABEL: Record<SavedSearchSection, string> = { jobs: "Jobs", declutter: "Declutter" };

export interface SavedSearch {
  id: string;
  name: string;
  section: string;
  query: string | null;
  category: string | null;
  min_budget: number | null;
  max_budget: number | null;
  radius_miles: number | null;
  parish: string | null;
  location_keyword: string | null;
  notify_enabled: boolean;
  notify_email: boolean;
  last_seen_at: string | null;
  created_at: string;
}

/** What a "Save this search" sheet is asked to save. */
export interface SearchDraft {
  section: SavedSearchSection;
  query: string;
  category: string | null;
  minDollars: number | null;
  maxDollars: number | null;
  radiusMiles: number | null;
  /** Where the radius measures from (BUY-49): Browse's own device or ZIP position. */
  origin?: { lat: number; lng: number } | null;
}

const COLUMNS =
  "id,name,section,query,category,min_budget,max_budget,radius_miles,parish,location_keyword,notify_enabled,notify_email,last_seen_at,created_at";

function categoryWord(section: string, category: string): string {
  if (section === "declutter") return CATEGORY_LABEL[category] ?? category;
  return (JOB_CATEGORY_LABELS as Record<string, string>)[category] ?? category;
}

function sectionWord(section: string): string {
  return SECTION_LABEL[section as SavedSearchSection] ?? section;
}

/** A saved search's longest default name. */
const NAME_MAX = 60;

/** `"chair" in Declutter` / `Yard work in Jobs` / `Everything in Jobs`. */
export function defaultName(d: Pick<SearchDraft, "section" | "query" | "category">): string {
  const q = d.query.trim();
  const where = ` in ${sectionWord(d.section)}`;
  const what = q ? `“${q}”` : d.category ? categoryWord(d.section, d.category) : "Everything";
  if (what.length + where.length <= NAME_MAX || !q) return `${what}${where}`.slice(0, NAME_MAX);
  // SS-7: a long search is cut at a word, with "…" and its closing quote, never mid-word ("…eight matching chai").
  const room = NAME_MAX - where.length - 3;
  const cut = q.slice(0, room + 1);
  const atWord = cut.lastIndexOf(" ");
  const words = (atWord > 0 ? cut.slice(0, atWord) : q.slice(0, room)).trimEnd();
  return `“${words}…”${where}`;
}

/** The filters in plain words: `Within 25 mi · under $100 · Furniture`. */
export function filterWords(s: { section: string; category: string | null; min_budget: number | null; max_budget: number | null; radius_miles: number | null }, withCategory = true): string[] {
  const out: string[] = [];
  if (s.radius_miles) out.push(`within ${s.radius_miles} mi`);
  if (s.min_budget && s.max_budget) out.push(`$${s.min_budget} to $${s.max_budget}`);
  else if (s.max_budget) out.push(`under $${s.max_budget}`);
  else if (s.min_budget) out.push(`$${s.min_budget} and up`);
  if (withCategory && s.category) out.push(categoryWord(s.section, s.category));
  return out;
}

/**
 * BUY-54: the same search saved twice sent every alert twice and used up the 10-search cap. Same section, words (any
 * case), category, price and distance = the same search (the origin is a rounded position; it does not make it new).
 */
export function sameSearch(s: Pick<SavedSearch, "section" | "query" | "category" | "min_budget" | "max_budget" | "radius_miles">, d: SearchDraft): boolean {
  const words = (q: string | null | undefined) => (q ?? "").trim().toLowerCase();
  return s.section === d.section && words(s.query) === words(d.query) && (s.category ?? null) === (d.category ?? null)
    && (s.min_budget ?? null) === (d.minDollars ?? null) && (s.max_budget ?? null) === (d.maxDollars ?? null)
    && (s.radius_miles ?? null) === (d.radiusMiles ?? null);
}

/** A saved row's line under its name: `Email · within 25 mi · under $100`. */
export function rowSummary(s: SavedSearch, paused = false): string {
  // "Pause all alerts" stops every search's alerts, so a row never claims a channel then.
  const channel = paused ? "Paused" : !s.notify_enabled ? "Alerts off" : s.notify_email ? "Email" : "App only";
  // The name already says the category when it was named after it.
  const named = !s.query?.trim() && !!s.category;
  return [channel, ...filterWords(s, !named)].join(" · ");
}

/** Where tapping a saved search goes: that section's Browse with the filters on. */
export function resultsPath(s: SavedSearch): string {
  const p = new URLSearchParams();
  if (s.query?.trim()) p.set("q", s.query.trim());
  if (s.category) p.set("cat", s.category);
  if (s.section === "declutter") {
    if (s.max_budget) p.set("max", String(s.max_budget));
    if (s.min_budget) p.set("min", String(s.min_budget));
    if (s.radius_miles) p.set("mi", String(s.radius_miles));
    // BUY-53: what "N new" counted (live_at after the last look, saved_search_new_counts), so Browse can mark them.
    const since = s.last_seen_at ?? s.created_at;
    if (since) p.set("new", since);
    const qs = p.toString();
    return `/declutter${qs ? `?${qs}` : ""}`;
  }
  if (s.min_budget) p.set("min", String(s.min_budget));
  if (s.max_budget) p.set("max", String(s.max_budget));
  if (s.radius_miles) p.set("loc", `nearby:${s.radius_miles}`);
  // Named, because /jobs?q= with no tab is an old My Jobs link and opens Working (resolveJobsTab, audit SS-1).
  return `/jobs?${new URLSearchParams([["tab", "browse"], ...p]).toString()}`;
}

/** The columns before 20261021042132, for the minutes between this bundle and db-deploy. */
const OLD_COLUMNS = "id,name,query,category,min_budget,max_budget,radius_miles,parish,location_keyword,notify_enabled,created_at";

export async function fetchSavedSearches(userId: string): Promise<SavedSearch[]> {
  const read = (cols: string) =>
    supabase
      .from("saved_searches")
      .select(cols)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      // enforce_saved_search_limit caps a member at 10; the bound is stated here too.
      .limit(50);
  const res = await read(COLUMNS);
  if (res.error?.code === "42703") {
    // The new columns are not deployed yet: every row is still a Jobs search
    // that emails, which is what the migration will make it.
    const old = (unwrap(await read(OLD_COLUMNS)) ?? []) as unknown as Omit<SavedSearch, "section" | "notify_email" | "last_seen_at">[];
    return old.map((r) => ({ ...r, section: "jobs", notify_email: true, last_seen_at: null }));
  }
  return (unwrap(res) ?? []) as unknown as SavedSearch[];
}

/**
 * search id -> matches since the member last looked. An empty map while the
 * RPC is not deployed yet (PGRST202): no badge is better than a wrong one.
 */
export async function fetchNewCounts(): Promise<Map<string, number>> {
  const res = await supabase.rpc("saved_search_new_counts");
  if (isMissingRpcNamed(res.error, "saved_search_new_counts")) return new Map();
  const rows = unwrap(res) ?? [];
  return new Map(rows.map((r) => [r.search_id, r.new_count]));
}

/**
 * NIGHT-SAVEDS1-SS-3: the 11th saved search is refused by the saved_searches trigger (migration 20260426132214,
 * "You can save up to 10 searches. Delete one to add another."), and both save screens said "Please try again",
 * which can never work. The limit is said instead; anything else keeps the caller's fallback.
 */
export const SAVED_SEARCH_CAP_COPY = "You can save up to 10 searches. Delete one in You › Settings › Saved searches, then save this one.";
export function savedSearchSaveError(err: unknown, fallback: string): string {
  const message = typeof err === "object" && err !== null && "message" in err ? String((err as { message: unknown }).message) : "";
  if (/save up to 10 searches/i.test(message)) return SAVED_SEARCH_CAP_COPY;
  return mutationErrorMessage(err, fallback);
}

export async function createSavedSearch(userId: string, d: SearchDraft, email: boolean): Promise<string> {
  const row = {
    user_id: userId,
    name: defaultName(d),
    section: d.section,
    query: d.query.trim() || null,
    category: d.category,
    min_budget: d.minDollars,
    max_budget: d.maxDollars,
    radius_miles: d.radiusMiles,
    notify_enabled: true,
    notify_email: email,
  };
  // Two decimals, about half a mile: enough to measure a radius, and no home address kept on the row.
  const origin = d.origin && d.radiusMiles ? { origin_lat: Math.round(d.origin.lat * 100) / 100, origin_lng: Math.round(d.origin.lng * 100) / 100 } : null;
  let res = await supabase.from("saved_searches").insert({ ...row, ...origin }).select("id");
  // PGRST204: the columns are not deployed yet; the search still saves and measures from the profile.
  if (origin && res.error?.code === "PGRST204") res = await supabase.from("saved_searches").insert(row).select("id");
  return unwrapMutation(res, { action: "save this search" })[0].id;
}

export async function updateSavedSearch(userId: string, id: string, patch: { notify_enabled?: boolean; notify_email?: boolean }): Promise<void> {
  unwrapMutation(
    await supabase.from("saved_searches").update(patch).eq("id", id).eq("user_id", userId).select("id"),
    { action: "update this alert", rejectedMessage: "That saved search is no longer there. Refreshing the list." },
  );
}

/** The member opened the results: "N new" starts again from now. */
export async function markSeen(userId: string, id: string): Promise<void> {
  unwrapMutation(
    await supabase.from("saved_searches").update({ last_seen_at: new Date().toISOString() }).eq("id", id).eq("user_id", userId).select("id"),
    { action: "open this search" },
  );
}

export async function deleteSavedSearch(userId: string, id: string): Promise<void> {
  unwrapMutation(
    await supabase.from("saved_searches").delete().eq("id", id).eq("user_id", userId).select("id"),
    { action: "delete this search", rejectedMessage: "That saved search was already gone. Refreshing the list." },
  );
}

/** "Pause all alerts" (notification_preferences.saved_searches_paused). */
export async function fetchPaused(userId: string): Promise<boolean> {
  const res = await supabase.from("notification_preferences").select("saved_searches_paused").eq("user_id", userId).maybeSingle();
  // Not deployed yet (42703): nothing can be paused before the column exists.
  if (res.error?.code === "42703") return false;
  return !!unwrap(res)?.saved_searches_paused;
}

export async function setPaused(userId: string, paused: boolean): Promise<void> {
  // notification_preferences always has a row per member (20260903012715).
  unwrapMutation(
    await supabase.from("notification_preferences").update({ saved_searches_paused: paused }).eq("user_id", userId).select("user_id"),
    { action: paused ? "pause your alerts" : "turn your alerts back on" },
  );
}
