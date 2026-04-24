import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";

/**
 * Resolves a Louisiana ZIP code to its parish via the
 * `get_parish_for_zip` Postgres function. Returns null if not found.
 *
 * Accepts any string — non-digits are stripped, only the first 5 digits used.
 */
export async function lookupParishByZip(zip: string | null | undefined): Promise<string | null> {
  if (!zip) return null;
  const cleaned = zip.replace(/\D/g, "").slice(0, 5);
  if (cleaned.length !== 5) return null;
  try {
    const { data, error } = await supabase.rpc("get_parish_for_zip", { p_zip: cleaned });
    if (error) {
      report(error, { severity: "warning", tags: { source: "parishLookup.rpc" } });
      return null;
    }
    return (data as string | null) || null;
  } catch (err) {
    report(err, { severity: "warning", tags: { source: "parishLookup" } });
    return null;
  }
}
