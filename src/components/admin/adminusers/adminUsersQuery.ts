/**
 * Server-side paging for the admin user list (Q232).
 *
 * AdminUsers used to `select("*")` every profile with no page size and derive
 * each tab count from that array, so the screen's cost and the correctness of
 * its counts both grew with the user table. Now the list reads one page at a
 * time (PAGE_SIZE rows, `.range()`), the tab / search / column sorts run in
 * Postgres, and every tab count is its own `count: "exact", head: true` query:
 * a number, never an array.
 *
 * Sorts that need another table (last login, pay, strikes) cannot be ordered by
 * PostgREST from `profiles`; the server returns newest-first pages and those
 * sorts reorder only the rows loaded so far. The UI says so beside the list.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Profile } from "../adminUserHelpers";
import type { SortDir, Tab } from "./useAdminUsersFilter";

export const ADMIN_USERS_PAGE_SIZE = 50;

// Full rows: every per-user dialog takes a Profile. What bounds the payload is
// the page size, not the column list.
export const ADMIN_USERS_COLUMNS = "*";

const BANNED = ["temp_banned", "permanently_banned"] as const;

/** Sorts Postgres can order by from `profiles` alone. */
export const SERVER_SORTS: ReadonlySet<SortDir> = new Set<SortDir>(["alpha", "joined_new", "joined_old"]);

// The subset of the PostgREST builder the filters use, so tests can hand in a
// recorder and assert exactly which filters a tab/search produces.
export interface FilterableQuery<Self> {
  eq(column: string, value: unknown): Self;
  in(column: string, values: readonly unknown[]): Self;
  or(filters: string): Self;
}

/** PostgREST `or=()` values containing , . : ( ) must be double-quoted. */
const quote = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

export function applyTabFilter<Q extends FilterableQuery<Q>>(q: Q, tab: Tab): Q {
  if (tab === "awaiting_email") return q.eq("email_verified", false);
  if (tab === "banned") return q.in("ban_status", BANNED);
  if (tab === "approved") {
    return q
      .eq("email_verified", true)
      .or(`ban_status.is.null,ban_status.not.in.(${BANNED.join(",")})`);
  }
  return q;
}

/**
 * Name / email substring, plus phone digits (4+) matched across whatever
 * punctuation the stored number carries ("5551234" finds "(504) 555-1234").
 * Returns null when there is nothing to filter on.
 */
export function searchOrFilter(raw: string): string | null {
  const q = raw.trim().replace(/[%*]/g, "");
  if (!q) return null;
  const parts = [`full_name.ilike.${quote(`*${q}*`)}`, `email.ilike.${quote(`*${q}*`)}`];
  const digits = q.replace(/\D/g, "");
  if (digits.length >= 4) parts.push(`phone.ilike.${quote(`*${digits.split("").join("*")}*`)}`);
  return parts.join(",");
}

export interface PageRequest {
  tab: Tab;
  search: string;
  sortDir: SortDir;
  offset: number;
}

export async function fetchUsersPage({ tab, search, sortDir, offset }: PageRequest): Promise<{ rows: Profile[]; total: number }> {
  // The page bound sits on the first line of the chain, so no later edit can
  // lose it (adminProfilesReadsAreBounded.test.ts reads this chain).
  let q = supabase
    .from("profiles")
    .select(ADMIN_USERS_COLUMNS, { count: "exact" })
    .range(offset, offset + ADMIN_USERS_PAGE_SIZE - 1);
  q = applyTabFilter(q, tab);
  const or = searchOrFilter(search);
  if (or) q = q.or(or);
  if (sortDir === "alpha") {
    q = q.order("full_name", { ascending: true, nullsFirst: false }).order("email", { ascending: true });
  } else {
    q = q.order("created_at", { ascending: sortDir === "joined_old" });
  }
  // Stable tiebreak so a page boundary never repeats or skips a row.
  q = q.order("id", { ascending: true });
  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as Profile[], total: count ?? 0 };
}

export type TabCounts = Record<Tab, number>;

/** One `head: true` count per tab: the counts never need the rows. */
export async function fetchTabCounts(): Promise<TabCounts> {
  const tabs: Tab[] = ["all", "approved", "awaiting_email", "banned"];
  const results = await Promise.all(
    tabs.map((t) => applyTabFilter(supabase.from("profiles").select("id", { count: "exact", head: true }), t)),
  );
  const out = {} as TabCounts;
  results.forEach((r, i) => {
    if (r.error) throw r.error;
    out[tabs[i]] = r.count ?? 0;
  });
  return out;
}

/** A single profile, for a deep link or rail entry that is not on a loaded page. */
export async function fetchUserById(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from("profiles").select(ADMIN_USERS_COLUMNS).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return (data as Profile | null) ?? null;
}
