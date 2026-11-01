/**
 * Q348 — are_users_blocked answers only for one of the pair (or a server).
 *
 * WHAT WAS BROKEN (prod, 2026-09-24/26): the function is SECURITY DEFINER and
 * EXECUTE-granted to authenticated, so any signed-in user could RPC it for two
 * third parties and learn whether one had blocked the other. It cannot be
 * revoked from authenticated: three RLS policies call it as the invoking role.
 *
 * THE FIX (20260926034721): answer only when auth.uid() is one of the pair or
 * is_server_context(); otherwise NULL, the same for every pair.
 *
 * WHY THE CALLER INVENTORY IS PINNED: the fix is safe only because every live
 * caller passes the signed-in user as one of the pair (enumerated from
 * pg_proc/pg_policies, 2026-09-26; see the migration header). A NEW caller
 * that asks about two other people would silently get NULL, so it fails
 * "the caller inventory is exact" until someone checks it passes a party.
 *
 * Behavioural proof, red-before/green-after, 3x replay:
 * scripts/probes/are-users-blocked-party.pglite.mjs.
 */
//
// Registered mutations - each turns this guard RED on its own:
//   Dropping the party rule restores the third-party oracle.
// @mutate supabase/migrations/20260926034721_are_users_blocked_party_only.sql |     WHEN COALESCE(auth.uid() IN (_user_a, _user_b), false) |     WHEN true
//   Dropping the trigger arm lets a system message cross a block (review F1).
// @mutate supabase/migrations/20260926034721_are_users_blocked_party_only.sql |       OR pg_trigger_depth() > 0 | 
//   Re-granting anon.
// @mutate supabase/migrations/20260926034721_are_users_blocked_party_only.sql | FROM PUBLIC, anon; | FROM PUBLIC;
import { describe, it, expect } from "vitest";
import { join, relative } from "node:path";
import { readFileSync } from "node:fs";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

const MIG_DIR = join(process.cwd(), "supabase/migrations");

// Functions whose effective definition calls are_users_blocked (pg_proc on
// prod matched the first 9, 2026-09-27, incl. the two series RPCs;
// insert_job_status_system_message joins in 20261003183349). The RPC-style ones
// pass auth.uid() as one argument, or pin one to auth.uid() before the call; the
// three triggers (enforce_block_on_message_insert, enforce_application_job_state,
// insert_job_status_system_message) get the real answer through the
// pg_trigger_depth() arm, because insert_job_status_system_message inserts
// messages between two people neither of whom is auth.uid().
const EXPECTED_CALLERS = [
  "accept_application",
  "accept_group_application",
  // Quotes on jobs (20261015091114): each sets v_uid := auth.uid() and passes
  // it, or a party it has just pinned to it, as one argument.
  // book_accepted_quote / get_quotes_for_request: v_uid is the poster (checked
  // against the request) vs the quoter. list_open_quote_requests /
  // submit_job_quote: the request's poster vs v_uid. respond_to_job_quote: the
  // poster vs the quoter, after v_uid is checked to be one of the two.
  "book_accepted_quote",
  "can_send_message_to_in_job",
  // Both pass v_uid := auth.uid() (never reassigned) as one argument
  // (20260927012806): the claimer vs the poster, and the poster vs the offeree.
  "claim_series_dates",
  // Q1185 (20261003214350): the direct offer's offeree vs its poster. Through
  // respond_to_direct_offer the offeree IS auth.uid(); through the profiles
  // trigger that completes a pending accept it is a server context at trigger
  // depth, which the party rule answers for (PGlite D6).
  "complete_direct_offer_accept",
  // Declutter slice 1 (20261014193955): v_uid := auth.uid() is one argument,
  // the item's seller the other (a blocked pair cannot watch or ask, B17).
  "declutter_ask_question",
  "declutter_checkout_free",
  // Declutter slice 3 (20261014210518): lock_buyable_item gets p_buyer =
  // v_uid := declutter_assert_member() (auth.uid()) from make_offer / buy_now;
  // respond_offer passes the thread's two parties, one of whom is v_uid
  // (the thread is found by buyer_id = v_uid OR seller_id = v_uid);
  // start_checkout passes (p_seller_id, v_uid).
  // Declutter slice 5 (20261017055505): each passes v_uid := auth.uid() (the
  // quoting buyer; the Helpr finding or taking a task) as one argument, the
  // seller / the task's buyer or seller the other.
  "declutter_delivery_quote",
  // A3-8 / A2-18 (20261028210552): the tip line checks the order's buyer against the delivery's own Helpr
  // (helpr_tasks.helpr_id of the order's task), both parties to that delivery, as helpr_task_tip_start does.
  "declutter_delivery_tip_open",
  // The Free change (Q2487, 20261030064021): the caller (declutter_assert_member() / auth.uid()) and the seller or asker.
  "declutter_free_requests_for_item",
  "declutter_item_pickup_places",
  "declutter_lock_buyable_item",
  // The paid-order chat (20261030004216, D2-1): the caller must be the order's buyer or seller (declutter_order_side), and
  // each passes the order's own pair (o.buyer_id, o.seller_id), so the caller is always one party.
  "declutter_my_order_talks",
  // I have this's listing read (20261030221255): v_uid and the Wanted post's owner, as in the browse below.
  "declutter_my_reply_listings",
  // Wanted photos and replies (20261030064727, B82): v_uid := auth.uid() (the poster reading the replies to their own posts) and each reply's seller.
  "declutter_my_wanted",
  // The handover chat (20261028235249, #3730): v_uid := auth.uid() (the caller is one of the pair), then are_users_blocked(buyer, seller).
  "declutter_open_handover_talk",
  // The paid-order chat view: declutter_order_side(o.buyer_id, o.seller_id, auth.uid()) must name a side first.
  "declutter_order_talk_view",
  // The Free change (Q2487, 20261030064021): the caller (declutter_assert_member() / auth.uid()) and the seller or asker.
  "declutter_pick_free_request",
  // Price-drop alerts (20261027204745, Train D): an AFTER UPDATE trigger on declutter_items passes the
  // pair (the watcher, the item's seller); neither is necessarily auth.uid() (the evening sweep lowers
  // prices as service_role) and it gets the real answer through the pg_trigger_depth() > 0 arm.
  "declutter_price_drop_alert",
    "declutter_question_notice",
  // The Free change (Q2487, 20261030064021): the caller (declutter_assert_member() / auth.uid()) and the seller or asker.
  "declutter_request_free",
  "declutter_respond_offer",
  // Moving-out mode (20261016053625): declutter_seller_moving_sale passes
  // (v_uid := auth.uid(), p_seller_id), so the caller is always one party.
  "declutter_seller_delivery_offer",
  "declutter_seller_moving_sale",
  // Porch places (D-NEW14, 20261030164712): both pass (p_seller_id, v_uid := declutter_assert_member(...)).
  "declutter_seller_porch_places",
  // The handover chat: the caller is the talk's buyer or seller (the row is read WHERE buyer_id = v_uid OR seller_id = v_uid).
  "declutter_send_handover_message",
  // The paid-order chat: membership is checked first (buyer_id = v_uid OR seller_id = v_uid), then are_users_blocked(o.buyer_id, o.seller_id).
  "declutter_send_order_message",
  "declutter_set_porch_place",
  "declutter_set_watch",
  "declutter_start_checkout",
  // Declutter Wanted public replies (20261021031757, board 117): v_uid := declutter_assert_member(true)
  // is one argument, the Wanted post's owner (w.user_id) the other, in both the browse and the reply.
  "declutter_wanted_browse",
  "declutter_wanted_reply",
  "direct_accept_block_reason",
  "enforce_application_job_state",
  "enforce_block_on_message_insert",
  // Q739 (20261004162818): the poster's copy of an application hides a Helpr
  // blocked with them, as the applications policy does. export_my_data is
  // EXECUTE for service_role only (the export edge function, after it resolves
  // the caller), so auth.uid() is NULL there and the server context gets the
  // real answer for (helper, the exporting user).
  "export_my_data",
  "get_my_saved_helpers",
  "get_quotes_for_request",
  // "On your way" (20261027200024, Train D): v_uid := helpr_task_assert_helpr() (auth.uid()) is one
  // argument, the candidate task's buyer (customer_id) or seller (pickup_contact_id) the other.
  "helpr_route_suggestions",
  "helpr_task_accept",
  // Slice 5 (lh-authz-rls #8): an open task's view repeats open_near's check, (the caller, the buyer / the seller).
  // Go online (20261027203030, Train D): the AFTER INSERT trigger on helpr_tasks passes (an online
  // Helpr, the new task's buyer / seller); neither is necessarily auth.uid()
  // and it gets the real answer through the pg_trigger_depth() > 0 arm.
  "helpr_task_offer_online",
  "helpr_task_pickup_windows", // 20261028232930: the Helpr's Accept picker; passes the caller (v_uid) as one side
  "helpr_task_same_pickup_slot", // 20261030152601: the same filter on the Accept card; passes the caller (v_uid) as one side
  "helpr_task_send_message", // 20261031231948 (BUY-36, the delivery chat): v_uid := auth.uid() is one argument, a party of the task the other
  // Delivery tips (Q2453, 20261028014848): v_uid := auth.uid() (the delivery's buyer) is one argument,
  // the delivery's Helpr (t.helpr_id) the other.
  "helpr_task_tip_start",
  "helpr_task_view",
  "helpr_tasks_open_count", // audit 1c D3-6 (20261030044539): open_near's check, (the caller, the buyer / the seller)
  "helpr_tasks_open_near",
  // Q713 (20261003183349): the AFTER UPDATE OF status trigger skips a thread
  // participant blocked with the poster. Neither is necessarily auth.uid() (the
  // Helpr may be the one moving the status), and it gets the real answer the
  // same way enforce_block_on_message_insert does: pg_trigger_depth() > 0.
  "insert_job_status_system_message",
  // Board 66/172 s4 (20261021111723): the BEFORE INSERT OR UPDATE trigger on
  // jobs passes two parties, (a.helper_id, OLD.customer_id): the pending
  // applicant and the job's poster, so it never asks about a third person. It
  // gets the real answer through the pg_trigger_depth() > 0 arm; a NULL would
  // only hold that applicant's edit notice back.
  "jobs_open_edit_tells_applicants",
  "list_open_quote_requests",
  // The application notice (20261021174935) names the applicant only when neither has blocked the other:
  // a trigger, it passes both parties (NEW.helper_id, the job's owner) and reads the pg_trigger_depth() arm.
  "notify_on_application",
  "offer_series_dates",
  // Quote hire on pay (20261018155222): the AFTER UPDATE OF payment_status
  // trigger asks (the quoter, the job's poster) before it sends the quoter an
  // "Accept to start" notice. Neither is auth.uid() (the webhook writes the
  // payment as service_role); it gets the real answer through the
  // pg_trigger_depth() > 0 arm, and a NULL would only hold the notice back.
  "quote_job_funded_hires_quoter",
  "respond_to_direct_offer",
  "respond_to_job_quote",
  // Shops M1 (20261018164442): each passes v_uid := auth.uid() as one
  // argument: the maker vs the order's buyer (accept), the buyer vs the shop's
  // owner (order terms, request order).
  "shops_accept_order",
  "shops_order_terms",
  "shops_request_order",
  "submit_job_quote",
];

describe("Q348: are_users_blocked refuses a third-party pair", () => {
  const defs = effectiveDefs(MIG_DIR);
  const def = defs.get("are_users_blocked");
  const body = blankSqlComments(def?.stmt ?? "");

  it("the inventory is real", () => {
    expect(defs.size).toBeGreaterThan(100);
    expect(def, "are_users_blocked has no definition in the migrations").toBeTruthy();
  });

  it("the newest definition answers only for a party or a server context, before it reads user_blocks", () => {
    const rule = body.search(
      /when\s+coalesce\(\s*auth\.uid\(\)\s+in\s*\(\s*_user_a\s*,\s*_user_b\s*\)\s*,\s*false\s*\)\s+or\s+public\.is_server_context\(\)\s+or\s+pg_trigger_depth\(\)\s*>\s*0\s+then/i,
    );
    const read = body.search(/from\s+public\.user_blocks/i);
    expect(rule, `newest definition (${def?.file}) has no party rule`).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(rule);
    // No ELSE branch that could answer: a non-party gets NULL.
    expect(body.slice(rule, body.search(/\bend\s*;/i))).not.toMatch(/\belse\b/i);
  });

  it("the newest migration touching its grants revokes PUBLIC and anon", () => {
    const grantFiles = migrationFiles(MIG_DIR).filter((f) =>
      /on\s+function\s+public\.are_users_blocked/i.test(blankSqlComments(readFileSync(join(MIG_DIR, f), "utf8"))),
    );
    const newest = blankSqlComments(readFileSync(join(MIG_DIR, grantFiles[grantFiles.length - 1]), "utf8"));
    expect(newest).toMatch(/revoke\s+all\s+on\s+function\s+public\.are_users_blocked\(uuid,\s*uuid\)\s+from\s+public,\s*anon/i);
  });

  it("every policy that calls it pins one argument to auth.uid() in the same statement", () => {
    // A policy asking about two OTHER users would get NULL, which a USING or
    // WITH CHECK reads as not-true: it would silently hide rows / refuse writes.
    let policies = 0;
    for (const f of migrationFiles(MIG_DIR)) {
      const sql = blankSqlComments(readFileSync(join(MIG_DIR, f), "utf8"));
      for (const m of sql.matchAll(/create\s+policy[\s\S]*?;/gi)) {
        if (!/are_users_blocked\s*\(/i.test(m[0])) continue;
        policies++;
        expect(m[0], `${f}: policy calls are_users_blocked without auth.uid()`).toMatch(/auth\.uid\(\)/i);
      }
    }
    expect(policies).toBeGreaterThan(2);
  });

  it("RPC callers outside SQL are exact (server-role edge functions and the dead client wrapper)", () => {
    const hits: string[] = [];
    for (const file of walkSource([join(process.cwd(), "src"), join(process.cwd(), "supabase/functions")])) {
      if (/\.test\.|\/test\//.test(file)) continue;
      if (/rpc\(\s*["'`]are_users_blocked["'`]/.test(readFileSync(file, "utf8"))) hits.push(relative(process.cwd(), file));
    }
    // charge-recurring-visits calls it with the service key (a server context,
    // real answer). userBlocks.ts has 0 callers (Q348 note); a signed-in call
    // about someone else gets NULL there, never the answer.
    expect(hits.sort()).toEqual(["src/lib/userBlocks.ts", "supabase/functions/charge-recurring-visits/index.ts"]);
  });

  it("the caller inventory is exact (a new caller must be checked to pass a party)", () => {
    const callers = [...defs.entries()]
      .filter(([name, d]) => name !== "are_users_blocked" && /are_users_blocked\s*\(/i.test(blankSqlComments(d.stmt)))
      .map(([name]) => name)
      .sort();
    expect(callers.length).toBeGreaterThan(5);
    expect(callers).toEqual(EXPECTED_CALLERS);
  });
});
