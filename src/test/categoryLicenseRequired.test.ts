/**
 * Mobile job categories and the license-required gate (owner 2026-10-19 ~18:50Z,
 * relayed by the lead): Automotive, Pets, Home, Beauty & Self-Care and Events
 * gain the services people book to come to them, picked in two steps (main
 * category, then its subs); on locksmith, mobile_vet, hair_stylist, massage and
 * mobile_bartending a Helpr needs a VERIFIED license covering that category to
 * apply, quote or be offered / hired. A poster can always post.
 *
 * Checked on the definitions the migrations leave (effectiveDefs) and on the
 * app's own tables:
 *   1. one set: LICENSE_REQUIRED_CATEGORIES (client) == category_requires_license (server);
 *   2. the three gates: applications (enforce_application_credential_tier),
 *      quotes (trg_quote_category_license BEFORE INSERT ON job_quotes) and the
 *      job itself (trg_job_category_license: helper_id AND offered_to_helper_id);
 *   3. helper_holds_category_license is not callable by a client;
 *   4. the claim is reviewed: a non-admin changing license_categories on a
 *      verified license sends it back to pending;
 *   5. every category sits in exactly one picker group, every enum value has a
 *      label, and every label is an enum value some migration adds;
 *   6. the screens: the sheet's "License needed" footer and the card's
 *      "Licensed pros only" line, and the viewer rule (verified, unexpired, named).
 *
 * Behaviour, red then green: src/test/pglite/categoryLicenseRequired.pglite.mjs
 * (27/27 with both migrations, 17 [fix] checks fail on main's definitions).
 */
// @mutate supabase/migrations/20261019184311_category_license_required.sql |   IF public.category_requires_license(v_category)\n     AND NOT public.helper_holds_category_license(NEW.helper_id, v_category) THEN | IF false THEN
// @mutate supabase/migrations/20261019184311_category_license_required.sql | 'massage', 'mobile_bartending']), false); | 'massage']), false);
// @mutate supabase/migrations/20261019184311_category_license_required.sql |      AND NOT public.helper_holds_category_license(NEW.offered_to_helper_id, NEW.category) THEN |      AND false THEN
// @mutate supabase/migrations/20261019184311_category_license_required.sql | REVOKE ALL ON FUNCTION public.helper_holds_category_license(uuid, public.job_category) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.helper_holds_category_license(uuid, public.job_category) FROM PUBLIC, anon;
// @mutate supabase/migrations/20261019184311_category_license_required.sql |   IF NEW.license_categories IS DISTINCT FROM OLD.license_categories AND NOT is_admin_writer THEN |   IF false THEN
// @mutate supabase/migrations/20261019184311_category_license_required.sql |       BEFORE INSERT ON public.job_quotes | BEFORE UPDATE ON public.job_quotes
// @mutate supabase/migrations/20261019184311_category_license_required.sql |   BEFORE INSERT OR UPDATE OF helper_id, offered_to_helper_id, category ON public.jobs |   BEFORE INSERT OR UPDATE OF helper_id, category ON public.jobs
// @mutate src/lib/jobCategories.ts | items: ["hair_stylist", "makeup_spray_tan", "massage"] | items: ["hair_stylist", "makeup_spray_tan"]
// @mutate src/lib/jobCategories.ts |   mobile_bartending: "a Louisiana ATC server permit (bar card)",\n |
// @mutate src/components/dashboard/jobDetailDialog/JobDetailFooter.tsx | ) : needsCategoryLicense(job.category, viewerLicensedCategories) ? ( | ) : false ? (
// @mutate src/components/dashboard/JobCard.tsx | {categoryRequiresLicense(job.category) && ( | {false && (
// @mutate src/hooks/useViewerLicensedCategories.ts |   if (row.license_expires_at <= today) return [];\n |
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import {
  JOB_CATEGORY_GROUPS,
  JOB_CATEGORY_LABELS,
  JOB_CATEGORY_VALUES,
  LICENSE_REQUIRED_CATEGORIES,
} from "@/lib/jobCategories";
import { licensedCategoriesOf, needsCategoryLicense } from "@/hooks/useViewerLicensedCategories";
import { Constants } from "@/integrations/supabase/types";

const ROOT = join(__dirname, "..", "..");
const MIG_DIR = join(ROOT, "supabase", "migrations");
const defs = effectiveDefs(MIG_DIR);
const body = (fn: string) => {
  const d = defs.get(fn);
  if (!d) throw new Error(`${fn}: no definition left by the migrations`);
  return blankSqlComments(d.stmt);
};
const migrations = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const allSql = migrations.map((f) => ({ f, sql: blankSqlComments(readFileSync(join(MIG_DIR, f), "utf8")) }));
const src = (p: string) => blankComments(readFileSync(join(ROOT, p), "utf8"));

/** The newest CREATE TRIGGER <name> statement across the migrations. */
function newestTrigger(name: string): string | null {
  let out: string | null = null;
  for (const { sql } of allSql) {
    for (const m of sql.matchAll(new RegExp(`CREATE\\s+TRIGGER\\s+${name}\\b[\\s\\S]*?;`, "gi"))) out = m[0];
  }
  return out;
}

const LICENSED = Object.keys(LICENSE_REQUIRED_CATEGORIES).sort();

describe("license-required job categories: one set, enforced on the server", () => {
  it("the client set and category_requires_license() name the same five categories", () => {
    const fn = body("category_requires_license");
    const arr = /ARRAY\[([^\]]*)\]/.exec(fn)?.[1] ?? "";
    const server = [...arr.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(server.length).toBeGreaterThan(3);
    expect(server).toEqual(LICENSED);
    expect(LICENSED).toEqual(["hair_stylist", "locksmith", "massage", "mobile_bartending", "mobile_vet"]);
  });

  it("an application in a license-required category needs a license covering it (before the tier check)", () => {
    const gate = body("enforce_application_credential_tier");
    const check = gate.search(
      /IF public\.category_requires_license\(v_category\)\s+AND NOT public\.helper_holds_category_license\(NEW\.helper_id, v_category\) THEN\s+RAISE EXCEPTION 'category_license_required'/,
    );
    expect(check, "the application gate no longer checks the category license").toBeGreaterThan(-1);
    expect(gate.indexOf("is_server_context()")).toBeLessThan(check);
    expect(gate).toMatch(/RAISE EXCEPTION 'credential_tier_required'/);
    const trg = newestTrigger("trg_application_credential_gate");
    expect(trg).toMatch(/BEFORE INSERT ON public\.applications/);
  });

  it("a quote on a license-required request needs the license, on every insert", () => {
    expect(body("enforce_quote_category_license")).toMatch(
      /IF public\.category_requires_license\(v_category\)\s+AND NOT public\.helper_holds_category_license\(NEW\.quoter_id, v_category\) THEN\s+RAISE EXCEPTION 'category_license_required'/,
    );
    expect(newestTrigger("trg_quote_category_license")).toMatch(
      /BEFORE INSERT ON public\.job_quotes\s+FOR EACH ROW EXECUTE FUNCTION public\.enforce_quote_category_license\(\)/,
    );
  });

  it("nobody unlicensed is offered, hired or kept on a job switched into a license-required category", () => {
    const fn = body("enforce_job_category_license");
    expect(fn).toMatch(/AND NOT public\.helper_holds_category_license\(NEW\.helper_id, NEW\.category\) THEN\s+RAISE EXCEPTION 'category_license_required'/);
    expect(fn).toMatch(/AND NOT public\.helper_holds_category_license\(NEW\.offered_to_helper_id, NEW\.category\) THEN\s+RAISE EXCEPTION 'category_license_required'/);
    expect(newestTrigger("trg_job_category_license")).toMatch(
      /BEFORE INSERT OR UPDATE OF helper_id, offered_to_helper_id, category ON public\.jobs\s+FOR EACH ROW EXECUTE FUNCTION public\.enforce_job_category_license\(\)/,
    );
  });

  it("a license covers a category only when verified, unexpired and naming it", () => {
    const fn = body("helper_holds_category_license");
    expect(fn).toMatch(/p\.license_status = 'verified'/);
    expect(fn).toMatch(/p\.license_expires_at IS NOT NULL\s+AND p\.license_expires_at > current_date/);
    expect(fn).toMatch(/p_category = ANY \(p\.license_categories\)/);
  });

  it("helper_holds_category_license is not callable by a client (the newest REVOKE names authenticated)", () => {
    let last = "";
    for (const { sql } of allSql) {
      for (const m of sql.matchAll(/REVOKE ALL ON FUNCTION public\.helper_holds_category_license\(uuid, public\.job_category\) FROM ([^;]*);/g)) last = m[1];
    }
    expect(last).toMatch(/\bauthenticated\b/);
    expect(last).toMatch(/\banon\b/);
  });

  it("changing the licensed categories on a verified license re-enters review", () => {
    expect(body("auto_pending_credentials")).toMatch(
      /IF NEW\.license_categories IS DISTINCT FROM OLD\.license_categories AND NOT is_admin_writer THEN\s+IF OLD\.license_status = 'verified' AND NEW\.license_status = 'verified' THEN\s+NEW\.license_status := 'pending';/,
    );
  });
});

describe("mobile categories: labels, enum and the two-step groups", () => {
  it("every enum value has a label and every label is an enum value a migration adds", () => {
    const added = new Set<string>();
    for (const { sql } of allSql) {
      for (const m of sql.matchAll(/ALTER TYPE public\.job_category ADD VALUE IF NOT EXISTS '([a-z_]+)'/g)) added.add(m[1]);
    }
    expect(added.size).toBeGreaterThan(20);
    for (const v of ["tire_service", "dent_windshield", "car_detailing", "locksmith", "pet_grooming", "pet_waste_removal", "mobile_vet", "gutter_cleaning", "window_washing", "tv_mounting", "hair_stylist", "makeup_spray_tan", "massage", "mobile_bartending", "drink_carts", "food_truck", "photo_booth"]) {
      expect(added.has(v), v).toBe(true);
    }
    expect([...JOB_CATEGORY_VALUES].sort()).toEqual([...Constants.public.Enums.job_category].sort());
  });

  it("every category sits in exactly one group; Beauty & Self-Care is a main group", () => {
    const seen = new Map<string, number>();
    for (const g of JOB_CATEGORY_GROUPS) {
      expect(g.items.length, g.slug).toBeGreaterThan(0);
      expect((g.items as ReadonlyArray<string>).includes(g.icon), `${g.slug} icon`).toBe(true);
      for (const c of g.items) seen.set(c, (seen.get(c) ?? 0) + 1);
    }
    const missing = JOB_CATEGORY_VALUES.filter((c) => seen.get(c) !== 1);
    expect(missing).toEqual([]);
    expect(seen.size).toBe(JOB_CATEGORY_VALUES.length);
    const beauty = JOB_CATEGORY_GROUPS.find((g) => g.label === "Beauty & Self-Care");
    expect(beauty?.items).toEqual(["hair_stylist", "makeup_spray_tan", "massage"]);
    expect(JOB_CATEGORY_GROUPS[JOB_CATEGORY_GROUPS.length - 1].items).toEqual(["other"]);
    expect(Object.keys(JOB_CATEGORY_LABELS).length).toBe(JOB_CATEGORY_VALUES.length);
  });
});

describe("the screens say it before the server refuses it", () => {
  it("the job sheet's footer shows 'License Needed to Apply' for an unlicensed viewer", () => {
    const footer = src("src/components/dashboard/jobDetailDialog/JobDetailFooter.tsx");
    expect(footer).toMatch(/\) : needsCategoryLicense\(job\.category, viewerLicensedCategories\) \? \(/);
    expect(footer).toMatch(/License Needed to Apply/);
    const dialog = src("src/components/dashboard/JobDetailDialog.tsx");
    expect(dialog).toMatch(/!needsCategoryLicense\(job\.category, viewerLicensedCategories\)/);
  });

  it("the job card says 'Licensed pros only' on a license-required category", () => {
    const card = src("src/components/dashboard/JobCard.tsx");
    expect(card).toMatch(/\{categoryRequiresLicense\(job\.category\) && \(/);
    expect(card).toMatch(/Licensed pros only/);
  });

  it("the viewer rule: verified, unexpired and naming the category; unknown never blocks", () => {
    const today = "2026-10-19";
    const ok = { license_status: "verified", license_expires_at: "2027-01-01", license_categories: ["massage", "cleaning"] };
    expect(licensedCategoriesOf(ok, today)).toEqual(["massage"]);
    expect(licensedCategoriesOf({ ...ok, license_status: "pending" }, today)).toEqual([]);
    expect(licensedCategoriesOf({ ...ok, license_expires_at: "2026-10-19" }, today)).toEqual([]);
    expect(licensedCategoriesOf({ ...ok, license_expires_at: null }, today)).toEqual([]);
    expect(needsCategoryLicense("massage", ["massage"])).toBe(false);
    expect(needsCategoryLicense("massage", ["hair_stylist"])).toBe(true);
    expect(needsCategoryLicense("massage", null)).toBe(false);
    expect(needsCategoryLicense("cleaning", [])).toBe(false);
  });
});
