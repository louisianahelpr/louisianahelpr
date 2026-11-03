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
 * @mutate supabase/migrations/20261103041633_quote_not_found_is_404.sql | IF NOT FOUND THEN\n    RAISE EXCEPTION 'unknown_quote' USING ERRCODE = 'PT404'; | IF NOT FOUND THEN\n    RAISE EXCEPTION 'unknown_quote' USING ERRCODE = 'P0002';
 * @mutate supabase/migrations/20261103041633_quote_not_found_is_404.sql | IS DISTINCT FROM v_uid THEN\n    RAISE EXCEPTION 'unknown_quote' USING ERRCODE = 'PT404'; | IS DISTINCT FROM v_uid THEN\n    RAISE EXCEPTION 'unknown_quote' USING ERRCODE = 'P0002';
 * @mutate supabase/migrations/20261103041633_quote_not_found_is_404.sql | IS DISTINCT FROM v_uid THEN\n    RAISE EXCEPTION 'unknown_request' USING ERRCODE = 'PT404'; | IS DISTINCT FROM v_uid THEN\n    RAISE EXCEPTION 'unknown_request' USING ERRCODE = 'P0002';
 * @mutate supabase/migrations/20261103041633_quote_not_found_is_404.sql | r.poster_id = v_uid) THEN\n    RAISE EXCEPTION 'unknown_request' USING ERRCODE = 'PT404'; | r.poster_id = v_uid) THEN\n    RAISE EXCEPTION 'unknown_request' USING ERRCODE = 'P0002';
 * @mutate supabase/migrations/20261103042402_booking_continue_day_nudge_not_found_is_404.sql | RAISE EXCEPTION 'unknown_request' USING ERRCODE = 'PT404'; | RAISE EXCEPTION 'unknown_request' USING ERRCODE = 'P0002';
 * @mutate supabase/migrations/20261103042402_booking_continue_day_nudge_not_found_is_404.sql | RAISE EXCEPTION 'continue_day_not_found' USING ERRCODE = 'PT404'; | RAISE EXCEPTION 'continue_day_not_found' USING ERRCODE = 'P0002';
 * @mutate supabase/migrations/20261103042402_booking_continue_day_nudge_not_found_is_404.sql | RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'PT404'; | RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'P0002';
 * @mutate supabase/migrations/20261103043002_job_offers_arrival_continue_day_not_found_is_404.sql | FOR SHARE;\n  IF NOT FOUND THEN\n    RAISE EXCEPTION 'unknown_request' USING ERRCODE = 'PT404'; | FOR SHARE;\n  IF NOT FOUND THEN\n    RAISE EXCEPTION 'unknown_request' USING ERRCODE = 'P0002';
 * @mutate supabase/migrations/20261103043002_job_offers_arrival_continue_day_not_found_is_404.sql | IF public.are_users_blocked(v_req.poster_id, v_uid) THEN\n    RAISE EXCEPTION 'unknown_request' USING ERRCODE = 'PT404'; | IF public.are_users_blocked(v_req.poster_id, v_uid) THEN\n    RAISE EXCEPTION 'unknown_request' USING ERRCODE = 'P0002';
 * @mutate supabase/migrations/20261103043002_job_offers_arrival_continue_day_not_found_is_404.sql | IF NOT FOUND THEN\n    RAISE EXCEPTION 'unknown_quote' USING ERRCODE = 'PT404'; | IF NOT FOUND THEN\n    RAISE EXCEPTION 'unknown_quote' USING ERRCODE = 'P0002';
 * @mutate supabase/migrations/20261103043002_job_offers_arrival_continue_day_not_found_is_404.sql | the quote exists.\n    RAISE EXCEPTION 'unknown_quote' USING ERRCODE = 'PT404'; | the quote exists.\n    RAISE EXCEPTION 'unknown_quote' USING ERRCODE = 'P0002';
 * @mutate supabase/migrations/20261103043002_job_offers_arrival_continue_day_not_found_is_404.sql | both run the transition.\n  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;\n  IF v_job.id IS NULL THEN\n    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'PT404'; | both run the transition.\n  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;\n  IF v_job.id IS NULL THEN\n    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'P0002';
 * @mutate supabase/migrations/20261103043002_job_offers_arrival_continue_day_not_found_is_404.sql | WHERE j.id = p_job_id\n   FOR UPDATE;\n  IF v_job.id IS NULL THEN\n    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'PT404'; | WHERE j.id = p_job_id\n   FOR UPDATE;\n  IF v_job.id IS NULL THEN\n    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'P0002';
 * @mutate supabase/migrations/20261103043002_job_offers_arrival_continue_day_not_found_is_404.sql | RAISE EXCEPTION 'continue_day_not_found' USING ERRCODE = 'PT404'; | RAISE EXCEPTION 'continue_day_not_found' USING ERRCODE = 'P0002';
 * @mutate supabase/migrations/20261103043002_job_offers_arrival_continue_day_not_found_is_404.sql | two verdicts against one row.\n  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;\n  IF v_job.id IS NULL THEN\n    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'PT404'; | two verdicts against one row.\n  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;\n  IF v_job.id IS NULL THEN\n    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'P0002';
 * @mutate supabase/migrations/20261103043845_cancel_quote_request_not_found_is_404.sql | IF NOT FOUND OR v_req.poster_id IS DISTINCT FROM v_uid THEN\n    RAISE EXCEPTION 'unknown_request' USING ERRCODE = 'PT404'; | IF NOT FOUND OR v_req.poster_id IS DISTINCT FROM v_uid THEN\n    RAISE EXCEPTION 'unknown_request' USING ERRCODE = 'P0002';
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

/**
 * Functions Q2390 has moved to PT404. Packet 1: save_my_phone (20261103040713). Packet 2: withdraw_job_quote,
 * switch_quote_request_to_set_price, get_quotes_for_request (20261103041633). Packet 3: book_accepted_quote,
 * confirm_job_continue_day, nudge_confirm (20261103042402). Packet 4: submit_job_quote, respond_to_job_quote,
 * helper_mark_on_the_way, propose_job_continue_day, answer_job_continue_day, mark_helper_arrival (20261103043002).
 * Packet 5: cancel_quote_request (20261103043845).
 */
const MOVED = ["save_my_phone", "withdraw_job_quote", "switch_quote_request_to_set_price", "get_quotes_for_request",
  "book_accepted_quote", "confirm_job_continue_day", "nudge_confirm",
  "submit_job_quote", "respond_to_job_quote", "helper_mark_on_the_way", "propose_job_continue_day", "answer_job_continue_day",
  "mark_helper_arrival", "cancel_quote_request"];
/** Functions whose live definition still raises ERRCODE 'P0002'. EXACT, both ways. */
const P0002_RAISERS = 289;

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
