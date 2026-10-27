/**
 * Q2437 (owner-approved 2026-10-27): "Find a Helpr" lists Helprs by skill and
 * town and offers a job through the existing direct-offer flow at the
 * POSTER'S price. No Helpr rates anywhere.
 *
 * Behaviour on real Postgres (every exclusion, the name mask, the literal
 * LIKE escape, anon refused, replay 3x): src/test/pglite/findHelprsDirectory.pglite.mjs.
 * This file holds the NEWEST definition of public.find_helprs (any dollar tag,
 * via effectiveDefs) and the page's wiring to it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { directoryCardFacts } from "@/pages/helprs/findHelprsModel";

// @mutate supabase/migrations/20261027201848_find_helprs_directory.sql |          public.display_name_for_viewer(p.full_name, p.user_id), |          p.full_name,
// @mutate supabase/migrations/20261027201848_find_helprs_directory.sql | REVOKE ALL ON FUNCTION public.find_helprs(text, text, integer) FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.find_helprs(text, text, integer) FROM PUBLIC;
// @mutate supabase/migrations/20261027201848_find_helprs_directory.sql |      AND NOT COALESCE(public.member_under_18(p.user_id), false) |      AND true
// @mutate supabase/migrations/20261027201848_find_helprs_directory.sql |      AND NOT EXISTS (\n       SELECT 1 FROM public.user_blocks b |      AND EXISTS (\n       SELECT 1 FROM public.user_blocks b
// @mutate supabase/migrations/20261027201848_find_helprs_directory.sql |   v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 30), 1), 50); |   v_limit integer := COALESCE(p_limit, 30);
// @mutate supabase/migrations/20261027201848_find_helprs_directory.sql |          p.skills,\n |          p.skills, p.hourly_rate,\n
// @mutate src/pages/helprs/FindHelprs.tsx | navigate(`/post-job?offerTo=${h.user_id}`) | navigate(`/post-job`)
// @mutate src/pages/helprs/findHelprsModel.ts |     place: h.town?.trim() \|\| parish, |     place: h.town?.trim() \|\| h.user_id,

const ROOT = resolve(__dirname, "..", "..");
const DIR = join(ROOT, "supabase", "migrations");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

function newest(name: string): { body: string; file: string; all: string } {
  const def = effectiveDefs(DIR).get(name);
  expect(def, `${name} has no definition in supabase/migrations`).toBeDefined();
  const all = readFileSync(join(DIR, def!.file), "utf8");
  return { body: blankSqlComments(def!.stmt), file: def!.file, all: blankSqlComments(all) };
}

describe("find_helprs (Q2437)", () => {
  const { body, all } = newest("find_helprs");

  it("returns names masked to first name + last initial, and no rate, phone, email or raw address", () => {
    const returns = body.match(/RETURNS\s+TABLE\s*\(([^)]*)\)/i)?.[1] ?? "";
    expect(returns.split(",").map((c) => c.trim().split(/\s+/)[0])).toEqual(
      ["user_id", "full_name", "avatar_url", "skills", "town", "parish", "is_id_verified"],
    );
    expect(body).toContain("public.display_name_for_viewer(p.full_name, p.user_id)");
    expect(body).not.toMatch(/hourly_rate|\bphone\b|\bemail\b(?!_verified)|street|address/i);
  });

  it("is for signed-in, unbanned members only", () => {
    expect(body).toMatch(/IF v_me IS NULL THEN\s+RAISE EXCEPTION 'not_signed_in'/);
    expect(body).toMatch(/IF public\.is_caller_banned\(\) THEN\s+RAISE EXCEPTION 'account_restricted'/);
    expect(all).toMatch(/REVOKE ALL ON FUNCTION public\.find_helprs\(text, text, integer\) FROM PUBLIC, anon;/);
    expect(all).toMatch(/GRANT EXECUTE ON FUNCTION public\.find_helprs\(text, text, integer\) TO authenticated;/);
  });

  it("leaves out the caller, banned, unverified, deleted, under-18, blocked and hidden test accounts", () => {
    for (const clause of [
      "p.user_id <> v_me",
      "p.email_verified",
      "p.anonymized_at IS NULL",
      "p.ban_status NOT IN ('banned', 'temp_banned', 'permanently_banned')",
      "NOT COALESCE(public.member_under_18(p.user_id), false)",
      "(p.is_seed IS NOT TRUE OR NOT (SELECT public.seed_hidden_from_caller()))",
    ]) expect(body, clause).toContain(clause);
    expect(body).toMatch(/AND NOT EXISTS \(\s*SELECT 1 FROM public\.user_blocks b/);
  });

  it("caps a call at 50 rows and matches typed text literally", () => {
    expect(body).toContain("v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 30), 1), 50);");
    expect((body.match(/replace\(replace\(replace\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

describe("Find a Helpr page (Q2437)", () => {
  const page = blankComments(read("src/pages/helprs/FindHelprs.tsx"));

  it("offers a job through the direct-offer flow, at the poster's price", () => {
    expect(page).toContain("navigate(`/post-job?offerTo=${h.user_id}`)");
    expect(page).toContain('supabase.rpc("find_helprs"');
    // No Helpr rate anywhere on the page.
    expect(page).not.toMatch(/hourly|\/hr\b|per hour|rate:/i);
  });

  it("is a signed-in route", () => {
    expect(read("src/App.tsx")).toMatch(/<Route path="\/helprs" element=\{<RouteErrorBoundary>\{routeEl\(<ProtectedRoute><FindHelprs \/>/);
  });

  it("the saved-Helpr picker links to it", () => {
    expect(blankComments(read("src/pages/post-job/OfferToSavedHelpr.tsx"))).toMatch(/to="\/helprs"/);
  });

  it("a card says the town (else the parish), rating or New, and jobs done", () => {
    const base = { user_id: "u1", full_name: "Ana B.", avatar_url: null, skills: "Yard work, Cleaning, Painting, Errands, Delivery", town: "New Iberia", parish: "Iberia", is_id_verified: true };
    const f = directoryCardFacts(base, { user_id: "u1", review_count: 3, avg_rating: "4.67", completed_jobs_as_helper: 5 });
    expect(f).toEqual({ name: "Ana B.", place: "New Iberia", rating: "4.7 (3 reviews)", jobsDone: "5 jobs done", skills: ["Yard work", "Cleaning", "Painting", "Errands"], moreSkills: 1 });
    const g = directoryCardFacts({ ...base, town: " ", full_name: null }, undefined);
    expect(g.place).toBe("Iberia Parish");
    expect(g.name).toBe("A neighbor");
    expect(g.rating).toBe("New");
    expect(g.jobsDone).toBe("0 jobs done");
  });
});
