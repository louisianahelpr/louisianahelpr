/**
 * JOB PHOTOS ON SOCIAL MEDIA, WITH AN OPT-OUT (owner 2026-10-20).
 *
 * The Terms ("Photos from jobs") and the Privacy policy both name the opt-out
 * by the exact label You › Settings shows, SHARE_JOB_PHOTOS_LABEL
 * (src/lib/jobPhotosConsent.ts); the Terms say a job's photos are used only
 * when BOTH the poster and the Helpr allow it; the setting writes
 * profiles.share_job_photos (checked write) and the server helper
 * job_photos_shareable is admin-only and needs every party's yes (PGlite proof:
 * src/test/pglite/jobPhotosShareable.pglite.mjs, S2-S12).
 *
 * @mutate src/lib/jobPhotosConsent.ts | export const SHARE_JOB_PHOTOS_LABEL = "Let Helpr share my job photos"; | export const SHARE_JOB_PHOTOS_LABEL = "Share photos";
 * @mutate src/pages/info/legal/TermsSection.tsx | <p>A job&apos;s photos are only used when BOTH the poster and the Helpr allow it.</p> | <p>A job&apos;s photos may be used.</p>
 * @mutate src/pages/info/legal/PrivacySection.tsx | &ldquo;{SHARE_JOB_PHOTOS_LABEL}&rdquo; in{" "} | &ldquo;photo sharing&rdquo; in{" "}
 * @mutate src/components/profile/SettingsTab.tsx |         await supabase.from("profiles").update({ share_job_photos: next }).eq("user_id", profile.user_id).select("user_id"), |         await supabase.from("profiles").update({ share_job_photos: true }).eq("user_id", profile.user_id).select("user_id"),
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { SHARE_JOB_PHOTOS_LABEL } from "@/lib/jobPhotosConsent";

const read = (p: string) => blankComments(readFileSync(resolve(__dirname, "../..", p), "utf8"));

describe("job photos clause, opt-out and server helper", () => {
  it("the label is the owner's wording", () => {
    expect(SHARE_JOB_PHOTOS_LABEL).toBe("Let Helpr share my job photos");
  });

  it("Terms and Privacy name the setting by that label and link to Settings", () => {
    for (const f of ["src/pages/info/legal/TermsSection.tsx", "src/pages/info/legal/PrivacySection.tsx"]) {
      const src = read(f);
      expect(src, f).toContain("&ldquo;{SHARE_JOB_PHOTOS_LABEL}&rdquo;");
      expect(src, f).toContain('to="/profile?tab=settings"');
    }
    const terms = read("src/pages/info/legal/TermsSection.tsx");
    expect(terms).toContain("A job&apos;s photos are only used when BOTH the poster and the Helpr allow it.");
    expect(terms).toContain("It stops future posts; it can&apos;t pull posts already shared.");
  });

  it("the setting shows the label and writes the member's own flag, checked", () => {
    const src = read("src/components/profile/SettingsTab.tsx");
    expect(src).toContain("label={SHARE_JOB_PHOTOS_LABEL}");
    expect(src).toContain('await supabase.from("profiles").update({ share_job_photos: next }).eq("user_id", profile.user_id).select("user_id"),');
    expect(src).toMatch(/unwrapMutation\(\s*await supabase\.from\("profiles"\)\.update\(\{ share_job_photos: next \}\)/);
  });

  it("the migration defaults the flag on and keeps the helper admin-only, never anon", () => {
    const sql = readFileSync(resolve(__dirname, "../../supabase/migrations/20261021001940_job_photos_share_opt_out.sql"), "utf8");
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS share_job_photos boolean NOT NULL DEFAULT true/);
    expect(sql).toMatch(/IF NOT public\.has_role\(auth\.uid\(\), 'admin'\) THEN\s*RAISE EXCEPTION 'admin_only'/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.job_photos_shareable\(uuid\) FROM PUBLIC, anon;/);
  });
});
