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
