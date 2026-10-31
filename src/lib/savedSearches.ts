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
import { unwrapMutation } from "@/lib/mutationResult";
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

/** `"chair" in Declutter` / `Yard work in Jobs` / `Everything in Jobs`. */
export function defaultName(d: Pick<SearchDraft, "section" | "query" | "category">): string {
  const what = d.query.trim() ? `“${d.query.trim()}”` : d.category ? categoryWord(d.section, d.category) : "Everything";
  return `${what} in ${sectionWord(d.section)}`.slice(0, 60);
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
    const qs = p.toString();
    return `/declutter${qs ? `?${qs}` : ""}`;
  }
  if (s.min_budget) p.set("min", String(s.min_budget));
  if (s.max_budget) p.set("max", String(s.max_budget));
  if (s.radius_miles) p.set("loc", `nearby:${s.radius_miles}`);
  const qs = p.toString();
  return `/jobs${qs ? `?${qs}` : ""}`;
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

export async function createSavedSearch(userId: string, d: SearchDraft, email: boolean): Promise<string> {
  const rows = unwrapMutation(
    await supabase
      .from("saved_searches")
      .insert({
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
      })
      .select("id"),
    { action: "save this search" },
  );
  return rows[0].id;
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
