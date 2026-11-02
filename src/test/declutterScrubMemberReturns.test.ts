/**
 * Q1933: a deleted member's exact addresses and words never outlive the deletion on a settled Declutter sale. The
 * scrub the account purge runs (declutter_scrub_member) clears the delivery-row and Helpr-task addresses (Q2307) AND,
 * since 20261102035139, the buyer's return address, words and photos on their refund requests and the words and photos
 * a member wrote as the other side of a problem.
 * Backend proof: src/test/pglite/declutterScrubMemberReturns.pglite.mjs (3x; red on the previous body and on its
 * planted defects).
 *
 * @mutate supabase/migrations/20261102035139_declutter_scrub_member_returns.sql |          return_address = NULL, return_lat = NULL, return_lng = NULL |          return_lat = return_lat
 * @mutate supabase/migrations/20261102035139_declutter_scrub_member_returns.sql |      SET other_side_note = NULL, other_side_photo_paths = '{}' |      SET other_side_note = other_side_note
 * @mutate supabase/migrations/20261102035139_declutter_scrub_member_returns.sql |    WHERE q.order_id = o.id AND o.buyer_id = p_user_id |    WHERE q.order_id = o.id AND o.seller_id = p_user_id
 * @mutate supabase/functions/_shared/accountPurge.ts | await admin.rpc("declutter_scrub_member", { p_user_id: userId }) | await admin.rpc("declutter_scrub_member_off", { p_user_id: userId })
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const defs = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = (s: string) => s.replace(/\s+/g, " ");

/** Every address-like column on a table that outlives a deleted party, and the scrub line that clears it. */
const ADDRESS_COLUMNS: Array<[string, string]> = [
  ["declutter_order_deliveries.dropoff_address", "UPDATE public.declutter_order_deliveries d SET dropoff_address = 'Removed: account deleted'"],
  ["helpr_tasks.pickup_address", "UPDATE public.helpr_tasks t SET pickup_address = 'Removed: account deleted'"],
  ["helpr_tasks.dropoff_address", "UPDATE public.helpr_tasks t SET dropoff_address = 'Removed: account deleted'"],
  ["declutter_refund_requests.return_address", "return_address = NULL, return_lat = NULL, return_lng = NULL FROM public.declutter_orders o WHERE q.order_id = o.id AND o.buyer_id = p_user_id"],
];

describe("a deleted member's addresses and words are scrubbed from the sales that outlive them", () => {
  const body = flat(blankSqlComments(defs.get("declutter_scrub_member")?.stmt ?? ""));
  it("the newest scrub clears every address column on a surviving sale", () => {
    expect(defs.size).toBeGreaterThan(500);
    expect(body.length).toBeGreaterThan(2000);
    expect(ADDRESS_COLUMNS.length).toBeGreaterThan(3);
    for (const [col, line] of ADDRESS_COLUMNS) expect(body, col).toContain(line);
  });

  it("the refund request keeps its outcome; the problem's other side loses its words only when that side leaves", () => {
    expect(body).toContain("SET note = 'Removed: this member deleted their account.', photo_paths = '{}',");
    expect(body).toContain("SET other_side_note = NULL, other_side_photo_paths = '{}'");
    expect(body).toContain("AND p.reporter_id IS DISTINCT FROM p_user_id");
    expect(body).not.toMatch(/UPDATE public\.declutter_refund_requests q SET [^;]*status/);
  });

  it("the purge still calls the scrub before the account goes", () => {
    const purge = blankComments(readFileSync(join(process.cwd(), "supabase/functions/_shared/accountPurge.ts"), "utf8"));
    expect(purge).toContain('await admin.rpc("declutter_scrub_member", { p_user_id: userId })');
  });
});
