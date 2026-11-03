/**
 * "NOT FOUND" ANSWERS HTTP 404, NOT 500 (Q2390).
 *
 * THE BUG (lead 2026-10-25, item 9; lane C measured): PostgREST maps SQLSTATE
 * P0001 to 400 but every other P0 code, P0002 included, to 500. Functions that
 * raise their not-found as ERRCODE = 'P0002' answer a missing row as a server
 * failure, which shouldRetryQuery retries and alerts count. Live proof (lane C):
 * POST /rest/v1/rpc/rentals_public_listing with a bad slug answered HTTP 500
 * {"code":"P0002"}. RAISE ... USING ERRCODE = 'PT404' makes PostgREST answer 404
 * (src/lib/queryRetry.ts reads PT<status>).
 *
 * THE CHECK, from the migrations (effectiveDefs: the definition each function
 * is left with, comments blanked):
 *   1. every function moved so far (MOVED) raises PT404 and no P0002;
 *   2. the functions still raising P0002 are an EXACT ratchet (P0002_RAISERS):
 *      Q2390 moves them one family per packet, smallest first, verbatim from
 *      prod, lowering the number in the same commit; a new one fails.
 *
 * @mutate supabase/migrations/20261103040713_save_my_phone_not_found_is_404.sql | RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'PT404'; | RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

/** Functions Q2390 has moved to PT404 (packet 1: save_my_phone, 20261103040713). */
const MOVED = ["save_my_phone"];
/** Functions whose live definition still raises ERRCODE 'P0002'. EXACT, both ways. */
const P0002_RAISERS = 302;

const defs = effectiveDefs(join(process.cwd(), "supabase/migrations"));
const body = (name: string) => blankSqlComments(defs.get(name)?.stmt ?? "");
const RAISES_P0002 = /ERRCODE\s*=\s*'P0002'/i;

describe("not found answers 404 (Q2390)", () => {
  it("reads every function's live definition (inventory floor)", () => {
    expect(defs.size).toBeGreaterThan(1000);
  });

  it("each moved function raises PT404 and no P0002", () => {
    for (const name of MOVED) {
      expect(defs.has(name), name).toBe(true);
      expect(body(name), name).toMatch(/ERRCODE\s*=\s*'PT404'/);
      expect(body(name), name).not.toMatch(RAISES_P0002);
    }
  });

  it(`functions still raising P0002 are exactly ${P0002_RAISERS} (Q2390 ratchet)`, () => {
    const left = [...defs.keys()].filter((name) => RAISES_P0002.test(body(name)));
    expect(left.length).toBe(P0002_RAISERS);
  });
});
