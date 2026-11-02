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

/** Saves the choice to the account's row (one row per member). */
export async function saveSectionPrefsRow(userId: string, order: string[], hidden: string[]): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase.from("member_section_prefs").upsert(
    { user_id: userId, section_order: order, sections_hidden: hidden, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  return { error };
}
