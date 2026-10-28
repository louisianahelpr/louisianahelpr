/**
 * Owner 2026-10-28 (Q2461 / #3728): "30 days per round". A Declutter listing stays up 30 days, goes back up by
 * itself up to 3 more times, the seller is told 3 days before each round ends, then it comes off sale with the
 * next step offered (spec row 73). The sell flow says so (LISTING_LIFETIME). This binds the words to the rule
 * the database runs, read from the NEWEST definitions (comments blanked), and checks the hourly cron is there.
 * Behaviour (backfill, rounds, the cap, offers closed, reserved/paused untouched, one failure isolated) is the
 * PGlite proof src/test/pglite/declutterListingRounds.pglite.mjs.
 *
 * @mutate supabase/migrations/20261028164424_declutter_listing_rounds.sql |     NEW.listed_until := now() + interval '30 days'; |     NEW.listed_until := now() + interval '60 days';
 * @mutate supabase/migrations/20261028164424_declutter_listing_rounds.sql |       IF r.relist_count < 3 THEN |       IF r.relist_count < 5 THEN
 * @mutate supabase/migrations/20261028164424_declutter_listing_rounds.sql |        AND i.listed_until <= now() + interval '3 days' |        AND i.listed_until <= now() + interval '1 hour'
 * @mutate supabase/migrations/20261028164424_declutter_listing_rounds.sql |     PERFORM cron.schedule('declutter-listing-rounds', '31 * * * *', |     PERFORM cron.schedule('declutter-listing-rounds-off', '31 * * * *',
 * @mutate src/components/declutter/DeclutterSellSteps.tsx |   "30 days. If it hasn't sold, it goes back up by itself up to 3 more times (about 4 months). We'll remind you before each round ends."; |   "Until it sells or you take it down.";
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { LISTING_LIFETIME } from "@/components/declutter/DeclutterSellSteps";

const DIR = join(process.cwd(), "supabase/migrations");
const DEFS = effectiveDefs(DIR);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");
const MIG = blankSqlComments(readFileSync(join(DIR, "20261028164424_declutter_listing_rounds.sql"), "utf8"));

describe("Declutter listing rounds: the words match the rule the server runs", () => {
  it("reads a real inventory (floors)", () => {
    expect(body("declutter_listing_rounds_sweep").length).toBeGreaterThan(1500);
    expect(body("declutter_items_listing_round").length).toBeGreaterThan(150);
    expect(LISTING_LIFETIME.length).toBeGreaterThan(40);
  });

  it("a round is 30 days, the trigger starts it on going live, and the sweep renews it for 30", () => {
    expect(body("declutter_items_listing_round")).toContain("NEW.listed_until := now() + interval '30 days';");
    expect(MIG).toMatch(/CREATE TRIGGER trg_declutter_items_listing_round\s+BEFORE INSERT OR UPDATE OF status ON public\.declutter_items/);
    expect(body("declutter_listing_rounds_sweep")).toContain("listed_until = now() + interval '30 days'");
    expect(LISTING_LIFETIME).toMatch(/^30 days\./);
  });

  it("relisted up to 3 more times (relist_count's CHECK is 0..3), then off sale", () => {
    const b = body("declutter_listing_rounds_sweep");
    expect(b).toContain("IF r.relist_count < 3 THEN");
    expect(b).toContain("SET status = 'ended'");
    expect(LISTING_LIFETIME).toContain("up to 3 more times");
  });

  it("the seller is reminded 3 days before each round ends, once per round, through declutter_notify", () => {
    const b = body("declutter_listing_rounds_sweep");
    expect(b).toContain("AND i.listed_until <= now() + interval '3 days'");
    expect(b).toContain("AND i.round_nudged IS DISTINCT FROM i.relist_count");
    expect(b).toContain("PERFORM public.declutter_notify(it.seller_id, 'info',");
    expect(LISTING_LIFETIME).toContain("remind you before each round ends");
  });

  it("only live listings move (never one reserved under a buyer), and the cron runs hourly", () => {
    const b = body("declutter_listing_rounds_sweep");
    expect(b).toContain("WHERE i.status = 'live' AND i.listed_until IS NOT NULL AND i.listed_until <= now()");
    expect(MIG).toContain("PERFORM cron.schedule('declutter-listing-rounds', '31 * * * *',");
    expect(MIG).toContain("public.cron_record_work('declutter-listing-rounds', to_jsonb(public.declutter_listing_rounds_sweep()))");
  });
});
