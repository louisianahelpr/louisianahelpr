import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";

/**
 * Q233: which of these accounts are seed (demo/test) rows. For admin lists fed
 * by an RPC or a table with no `is_seed` column of its own, so they can drop
 * those rows (see withoutTestRows).
 * Throws on a failed read, like every other admin fetcher: a list that silently
 * lost its Test tags would read as all-real.
 */
export async function fetchSeedUserIds(userIds: (string | null | undefined)[]): Promise<Set<string>> {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return new Set();
  const rows = unwrap(
    await supabase.from("profiles").select("user_id").in("user_id", ids).eq("is_seed", true),
  );
  return new Set((rows ?? []).map((r) => r.user_id));
}

/**
 * Owner 2026-10-25 and again 2026-10-27 ("i should never see test stuff in my
 * admin panel"): admin screens never show a test (is_seed) row, not even with
 * a "Test" tag. Every admin list passes its rows through this before render.
 */
export function withoutTestRows<T extends { is_seed?: boolean | null }>(rows: T[]): T[] {
  return rows.filter((r) => !r.is_seed);
}

/**
 * Owner 2026-11-04 ("nothing test account should show on any real admin
 * stuff"): for an admin list whose rows name people but carry no is_seed of
 * their own (an RPC queue), drop every row that names a test account.
 * Throws on a failed read (fetchSeedUserIds), never shows the rows untagged.
 * Guard: src/components/admin/adminReadsDropTestRows.test.ts.
 */
export async function withoutTestPeople<T>(rows: T[], people: (row: T) => (string | null | undefined)[]): Promise<T[]> {
  if (rows.length === 0) return rows;
  const seed = await fetchSeedUserIds(rows.flatMap(people));
  if (seed.size === 0) return rows;
  return rows.filter((r) => !people(r).some((id) => !!id && seed.has(id)));
}

/**
 * Design audit area 10 #5 (11-18): test rows that no seed ACCOUNT gives away. Measured on prod 11-18 (read-only SQL):
 * the Audit log's table-write rows for user_bans read "SEED audit fixture." / "E2E ban journey lg0izi" (System actor,
 * so no seed admin to match), and Reports had "SEED audit fixture report." and "E2E-0905 automated test report" rows
 * whose reporter was deleted. Upper-case on purpose: a member writing "seed" or "e2e" in a real report is not matched.
 */
const TEST_TEXT_MARKER = /\bSEED audit fixture\b|\bE2E[-\s]/;

/** True when any text in `value` (a string, or JSON such as audit details) carries a test-run marker. */
export function mentionsTestMarker(...values: unknown[]): boolean {
  return values.some((v) => {
    if (v == null) return false;
    const text = typeof v === "string" ? v : JSON.stringify(v);
    return TEST_TEXT_MARKER.test(text);
  });
}
