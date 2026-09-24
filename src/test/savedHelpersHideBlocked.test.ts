/**
 * TS-011: Saved Helprs (and the offer-to-a-saved-Helpr picker, which reads the
 * same RPC) listed people you had blocked or who blocked you. The latest
 * definition of get_my_saved_helpers must filter blocks in both directions
 * (are_users_blocked is symmetric). Proven on PGlite 3x.
 *
 * @mutate supabase/migrations/20260924062150_saved_helpers_hide_blocked.sql | AND NOT public.are_users_blocked(fh.customer_id, fh.helper_id)  -- TS-011 block filter | -- (block filter removed)
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Saved Helprs hide blocked people (TS-011)", () => {
  it("the latest get_my_saved_helpers filters blocks", () => {
    const defs = readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(join("supabase/migrations", f), "utf8"))
      .filter((s) => /CREATE OR REPLACE FUNCTION public\.get_my_saved_helpers\(\)/.test(s));
    expect(defs.length).toBeGreaterThanOrEqual(3);
    const latest = defs[defs.length - 1];
    const body = latest.slice(latest.indexOf("CREATE OR REPLACE FUNCTION public.get_my_saved_helpers()"));
    expect(body).toMatch(/AND NOT public\.are_users_blocked\(fh\.customer_id, fh\.helper_id\)/);
  });
});
