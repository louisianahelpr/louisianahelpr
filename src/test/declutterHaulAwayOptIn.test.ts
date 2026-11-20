/**
 * Owner 2026-11-20: "I just got a message to haul away stuff that's on declutter I think we shouldn't offer to haul
 * away unless they pick that like who's going to haul away there good stuff they posted".
 *
 * Haul-away is the seller's choice: "If it doesn't sell, offer me a haul-away", per listing, OFF by default (migration
 * 20261120152652). This binds the NEWEST definitions (comments blanked) to that rule:
 *   - the CLASS: every server notice, in any function, whose words offer a haul-away (or a Helpr to take it to
 *     donation) reads the seller's choice (declutter_haul_away_opted_in); notices about a haul-away the seller
 *     already booked are an exact list;
 *   - the choice's gates and grants;
 *   - My listings: the card, line and tip only for opted-in listings, plus a haul-away already booked or linked.
 * Behaviour (who is told, wording per choice, refusals, 3x replay, RED on the old bodies) is the PGlite proof
 * src/test/pglite/declutterHaulAwayOptIn.pglite.mjs (NEW_MIGRATION=skip: 23 red, the owner's case among them).
 *
 * @mutate supabase/migrations/20261120152652_declutter_haul_away_opt_in.sql |        AND public.declutter_haul_away_opted_in(i.id)\n |        AND true\n
 * @mutate supabase/migrations/20261120152652_declutter_haul_away_opt_in.sql | CASE WHEN v_days <= 14 AND public.declutter_haul_away_opted_in(it.id) THEN | CASE WHEN v_days <= 14 THEN
 * @mutate supabase/migrations/20261120152652_declutter_haul_away_opt_in.sql | ELSE format('No one has claimed "%s" after four rounds. It comes down on %s.', | ELSE format('No one has claimed "%s" after four rounds. It comes down on %s. After that you can have a Helpr take it to donation.',
 * @mutate supabase/migrations/20261120152652_declutter_haul_away_opt_in.sql | ALTER TABLE public.declutter_item_private ADD COLUMN IF NOT EXISTS haul_away_opt_in boolean NOT NULL DEFAULT false; | ALTER TABLE public.declutter_item_private ADD COLUMN IF NOT EXISTS haul_away_opt_in boolean NOT NULL DEFAULT true;
 * @mutate supabase/migrations/20261120152652_declutter_haul_away_opt_in.sql | REVOKE ALL ON FUNCTION public.declutter_set_haul_away_opt_in(uuid, boolean) FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.declutter_set_haul_away_opt_in(uuid, boolean) FROM PUBLIC;
 * @mutate supabase/migrations/20261120152652_declutter_haul_away_opt_in.sql |    WHERE i.seller_id = v_uid AND p.haul_away_opt_in; |    WHERE p.haul_away_opt_in;
 * @mutate src/lib/declutter/haulAwayParam.ts |   return rows.filter((r) => LINKED_STATES.has(r.state) \|\| optedIn.has(r.item_id)); |   return rows;
 * @mutate src/components/declutter/DeclutterHomeView.tsx |       const rows = lib.offeredHaulAwayRows(all, optedIn); |       const rows = all;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { offeredHaulAwayRows, type HaulAwayRow, type HaulAwayState } from "@/lib/declutter/haulAwayParam";
import { enListingParts } from "@/lib/i18n/enListingParts";
import { esListingParts } from "@/lib/i18n/esListingParts";

const ROOT = process.cwd();
const DIR = join(ROOT, "supabase/migrations");
const FILE = "20261120152652_declutter_haul_away_opt_in.sql";
const DEFS = effectiveDefs(DIR);
const flat = (s: string) => s.replace(/\s+/g, " ");
const body = (name: string) => flat(blankSqlComments(DEFS.get(name)?.stmt ?? ""));
const MIG = flat(blankSqlComments(readFileSync(join(DIR, FILE), "utf8")));

/** Words that offer a haul-away to a seller who may not have asked for one. */
const OFFER = /Haul-away is open|before haul-away|have a Helpr take it to donation|book a Helpr to take (?:it|them) to donation/i;
/**
 * Notices about a haul-away the seller already booked (they tapped it themselves): exact, both ways.
 * Function -> how many of its string literals mention a haul-away.
 */
const BOOKED_HAUL_NOTICES: Record<string, number> = {
  // Part C: "Back on sale" / "Haul-away not booked" for a link the seller made, and its cron-defect lines.
  declutter_haul_away_sweep: 6,
  // "Haul-away refunded": the seller's own haul-away job was refunded.
  declutter_haul_away_job_refunded: 4,
};
/** Maps notice titles to their kind (the bell's filter); sends nothing, so its title list is not an offer. */
const TITLE_CLASSIFIERS = new Set(["declutter_notice_type"]);

/** Every newest function whose string literals mention a haul-away, with the literals. */
function haulLiterals(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [name, def] of DEFS) {
    const code = blankSqlComments(def.stmt);
    const lits = [...code.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]).filter((l) => /haul|take it to donation/i.test(l));
    // Feature keys, table/RPC names and error codes are not words a seller reads.
    const words = lits.filter((l) => /\s/.test(l));
    if (words.length > 0 && !TITLE_CLASSIFIERS.has(name)) out.set(name, words);
  }
  return out;
}

describe("Declutter haul-away is the seller's choice (owner 2026-11-20, 20261120152652)", () => {
  const lits = haulLiterals();

  it("reads a real inventory (floors)", () => {
    expect(DEFS.size).toBeGreaterThan(1000);
    // The classifier really does carry haul-away titles (so skipping it is a decision, not a no-op).
    expect(body("declutter_notice_type")).toContain("'Haul-away is open'");
    expect(lits.size).toBeGreaterThanOrEqual(4);
    expect(body("declutter_haul_away_sweep").length).toBeGreaterThan(3000);
    expect(body("declutter_auto_free_due").length).toBeGreaterThan(1500);
    expect(body("declutter_listing_rounds_sweep").length).toBeGreaterThan(1500);
  });

  it("CLASS: every notice whose words offer a haul-away reads the seller's choice", () => {
    const offering = [...lits].filter(([, ls]) => ls.some((l) => OFFER.test(l))).map(([n]) => n).sort();
    expect(offering).toEqual(["declutter_auto_free_due", "declutter_haul_away_sweep", "declutter_listing_rounds_sweep"]);
    for (const name of offering) expect(body(name), name).toContain("public.declutter_haul_away_opted_in(");
  });

  it("CLASS: any other function with haul-away words is about a haul-away the seller already booked (exact)", () => {
    const others = Object.fromEntries([...lits].filter(([n]) => !["declutter_auto_free_due", "declutter_listing_rounds_sweep"].includes(n))
      .map(([n, ls]) => [n, n === "declutter_haul_away_sweep" ? ls.filter((l) => !OFFER.test(l)).length : ls.length]));
    expect(others).toEqual(BOOKED_HAUL_NOTICES);
  });

  it("the 14-day notice: only opted-in listings, re-checked at the claim", () => {
    const s = body("declutter_haul_away_sweep");
    expect(s).toContain("AND public.declutter_haul_away_opted_in(i.id) AND NOT EXISTS (SELECT 1 FROM public.declutter_haul_away_notices n");
    expect(s).toContain("SELECT x FROM unnest(r.ids) x WHERE public.declutter_haul_away_opted_in(x) ON CONFLICT (item_id) DO NOTHING");
    expect(body("declutter_haul_away_opted_in")).toContain("SELECT COALESCE((SELECT p.haul_away_opt_in FROM public.declutter_item_private p WHERE p.item_id = p_item_id), false)");
  });

  it("the auto-free and listing-round notices say haul-away / donation only to an opted-in seller", () => {
    expect(body("declutter_auto_free_due")).toContain("CASE WHEN v_days <= 14 AND public.declutter_haul_away_opted_in(it.id) THEN ' One more chance before haul-away.' ELSE '' END");
    const r = body("declutter_listing_rounds_sweep");
    for (const words of ["Lower the price now, or after that you can have a Helpr take it to donation.", "After that you can have a Helpr take it to donation.",
      "Open Selling to have a Helpr take it to donation."]) {
      const at = r.indexOf(words);
      expect(at, words).toBeGreaterThan(0);
      // Each donation sentence sits in a branch that read the choice just before it.
      expect(r.slice(Math.max(0, at - 260), at), words).toContain("declutter_haul_away_opted_in(");
    }
  });

  it("off by default for every listing, existing ones included, and no catch-up notice", () => {
    expect(MIG).toContain("ALTER TABLE public.declutter_item_private ADD COLUMN IF NOT EXISTS haul_away_opt_in boolean NOT NULL DEFAULT false;");
    // No backfill writes the column on, and the migration sends nothing itself.
    expect(MIG).not.toMatch(/UPDATE public\.declutter_item_private SET haul_away_opt_in = true/i);
    const outsideFns = MIG.replace(/CREATE OR REPLACE FUNCTION .*?\$fn\$.*?\$fn\$;/g, "");
    expect(outsideFns).not.toMatch(/declutter_notify|INSERT INTO public\.notifications/);
  });

  it("the choice: seller's own listing, behind the switches, not for a banned caller; grants by role name", () => {
    const set = body("declutter_set_haul_away_opt_in");
    expect(set).toContain("PERFORM public.require_feature('declutter');");
    expect(set).toContain("IF public.is_caller_banned() THEN");
    expect(set).toContain("IF p_on THEN PERFORM public.require_feature('declutter_haul_away'); v_uid := public.declutter_assert_member(true);");
    expect(set).toContain("WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;");
    expect(body("declutter_haul_away_opt_in_state")).toContain("AND i.seller_id = v_uid");
    expect(body("declutter_haul_away_opt_ins")).toContain("WHERE i.seller_id = v_uid AND p.haul_away_opt_in;");
    for (const sig of ["declutter_set_haul_away_opt_in(uuid, boolean)", "declutter_haul_away_opt_in_state(uuid)", "declutter_haul_away_opt_ins()"]) {
      expect(MIG).toContain(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.${sig} TO authenticated, service_role;`);
    }
    expect(MIG).toContain("REVOKE ALL ON FUNCTION public.declutter_haul_away_opted_in(uuid) FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public.declutter_haul_away_opted_in(uuid) TO service_role;");
    for (const fn of ["declutter_haul_away_sweep()", "declutter_auto_free_due()", "declutter_listing_rounds_sweep()"]) {
      expect(MIG).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public.${fn} TO service_role;`);
    }
  });

  it("the seller's own taps still work: the link and the state read do not look at the choice", () => {
    expect(body("declutter_link_haul_away")).not.toContain("haul_away_opt_in");
    expect(body("declutter_haul_away_state")).not.toContain("haul_away_opt_in");
  });

  it("the setting's words, in English and Spanish", () => {
    for (const k of ["lp.haulOptTitle", "lp.haulOptExplainer", "lp.haulOptToastOn", "lp.haulOptToastOff"] as const) {
      expect(enListingParts[k], k).toBeTruthy();
      expect((esListingParts as Record<string, string>)[k], k).toBeTruthy();
    }
    expect(enListingParts["lp.haulOptTitle"]).toBe("If it doesn't sell, offer me a haul-away");
  });
});

describe("My listings offers a haul-away only for opted-in listings (offeredHaulAwayRows)", () => {
  const row = (item_id: string, state: HaulAwayState): HaulAwayRow => ({
    item_id, title: item_id, description: "", delivery_size: "large", item_status: "live", state,
    eligible_at: null, job_id: null, pickup_group: "g", photo_paths: [], job_hold: null,
  });
  const all: HaulAwayState[] = ["eligible", "too_soon", "in_sale", "hauled", "booked", "paying", "unpaid", "not_unsold"];

  it("nothing opted in: only a haul-away already booked or linked shows", () => {
    const rows = all.map((s) => row(s, s));
    expect(offeredHaulAwayRows(rows, new Set()).map((r) => r.state).sort()).toEqual(["booked", "hauled", "paying", "unpaid"]);
  });

  it("an opted-in listing keeps its eligible / too-soon row; another seller's choice never leaks in", () => {
    const rows = [row("a", "eligible"), row("b", "too_soon"), row("c", "eligible")];
    expect(offeredHaulAwayRows(rows, new Set(["a", "b"])).map((r) => r.item_id)).toEqual(["a", "b"]);
  });

  it("My listings filters through it and passes the choice to the paused line and count", () => {
    const src = blankComments(readFileSync(join(ROOT, "src/components/declutter/DeclutterHomeView.tsx"), "utf8"));
    expect(src).toContain("const rows = lib.offeredHaulAwayRows(all, optedIn);");
    expect(src).toContain("trip: lib.oneTripGroup(rows)");
    expect(src).toContain("optedIn={!!haul.data?.optedIn.has(item.id)}");
    expect(src).toContain('i.status === "paused" && !!haul.data?.optedIn.has(i.id)');
  });
});
