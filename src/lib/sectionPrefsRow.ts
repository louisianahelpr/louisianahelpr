/**
 * The member's own Customize row (public.member_section_prefs, 20261102074244, Q2199): the two reads/writes
 * useSectionPrefs makes, in one small data module so a spec that renders the nav can answer them locally
 * (vi.mock("@/lib/sectionPrefsRow")) without stubbing the whole hook (train 1 reds, 11-02: ten specs reached the
 * prod-network guard through it).
 */
import { supabase } from "@/integrations/supabase/client";

export type SectionPrefsRow = { section_order: string[]; sections_hidden: string[] };

/** The account's row, or null when it has none. The caller handles `error` (the device copy shows meanwhile). */
export async function fetchSectionPrefsRow(userId: string): Promise<{ data: SectionPrefsRow | null; error: { message: string } | null }> {
  const { data, error } = await supabase.from("member_section_prefs")
    .select("section_order, sections_hidden").eq("user_id", userId).maybeSingle();
  return { data: (data as SectionPrefsRow | null) ?? null, error };
}

/**
 * Saves the choice to the account's row (one row per member).
 *
 * Not an upsert: PostgREST turns `upsert(..., {onConflict})` into ON CONFLICT DO UPDATE SET for EVERY payload
 * column, user_id included, and 20261102074244 grants authenticated UPDATE only on (section_order,
 * sections_hidden, updated_at). So once a member had a row every later save failed 42501 (release gate
 * write-contract, 11-02). Instead: update the three granted columns; if that touched no row, insert the full row;
 * if the insert lost a race to another tab or device (23505), update once more.
 */
export async function saveSectionPrefsRow(userId: string, order: string[], hidden: string[]): Promise<{ error: { message: string } | null }> {
  const updatedAt = new Date().toISOString();
  const update = () => supabase.from("member_section_prefs")
    .update({ section_order: order, sections_hidden: hidden, updated_at: updatedAt }, { count: "exact" }).eq("user_id", userId);
  const first = await update();
  if (first.error) return { error: first.error };
  if ((first.count ?? 0) > 0) return { error: null };
  const inserted = await supabase.from("member_section_prefs")
    .insert({ user_id: userId, section_order: order, sections_hidden: hidden, updated_at: updatedAt });
  if (inserted.error?.code === "23505") {
    const retry = await update();
    return { error: retry.error };
  }
  return { error: inserted.error };
}
