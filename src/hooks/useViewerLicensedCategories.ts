import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { categoryRequiresLicense } from "@/lib/jobCategories";

/**
 * The license-required job categories the signed-in viewer is VERIFIED for
 * (owner 2026-10-19): their own profile's license is verified, unexpired, and
 * names the category in license_categories. The same rule as the server's
 * helper_holds_category_license(), which is what actually enforces it on
 * apply, quote and hire (20261019184311); this only decides which footer the
 * job sheet shows.
 *
 * Warmed by the feed with the same key and staleTime as the credential tier
 * (see useViewerCredentialTier for why: the sheet must know on frame one).
 * `null` = unknown (signed out, or the read failed): the sheet then shows the
 * normal Apply and the server's refusal explains it, rather than blocking on a
 * guess. Before the migration deploys the column does not exist (42703) and
 * this is quietly `null`.
 */
export function useViewerLicensedCategories(enabled: boolean): string[] | null {
  const { data } = useQuery({
    queryKey: ["viewerLicensedCategories"],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<string[] | null> => {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError && userError.name !== "AuthSessionMissingError") {
        report(userError, { severity: "warning", tags: { source: "useViewerLicensedCategories.getUser" } });
      }
      if (!user) return null;
      const { data: row, error } = await supabase
        .from("profiles")
        .select("license_status, license_expires_at, license_categories")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) {
        if ((error as { code?: string }).code !== "42703") report(error, { tags: { source: "useViewerLicensedCategories" } });
        return null;
      }
      return licensedCategoriesOf(row);
    },
  });
  return data ?? null;
}

/** The pure rule, exported for its test. */
export function licensedCategoriesOf(
  row: { license_status?: string | null; license_expires_at?: string | null; license_categories?: string[] | null } | null,
  today: string = new Date().toISOString().slice(0, 10),
): string[] {
  if (!row || row.license_status !== "verified" || !row.license_expires_at) return [];
  if (row.license_expires_at <= today) return [];
  return (row.license_categories ?? []).filter((c) => categoryRequiresLicense(c));
}

/** Whether this viewer must add a license before applying to a job in `category`. */
export function needsCategoryLicense(category: string | null | undefined, licensed: string[] | null): boolean {
  if (!categoryRequiresLicense(category) || licensed === null) return false;
  return !licensed.includes(category as string);
}
