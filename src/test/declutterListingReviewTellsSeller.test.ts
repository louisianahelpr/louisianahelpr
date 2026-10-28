/**
 * Q2414 (owner's Declutter walkthrough, 2026-10-27): approving or rejecting a
 * listing tells the seller, as the Selling tab promises. Before
 * 20261027182550, declutter_admin_review_item changed the status and wrote the
 * audit row but sent no notice. Reads the NEWEST definition, so a later
 * restatement that drops either notice turns this red.
 *
 * @mutate supabase/migrations/20261028200440_declutter_audit3_notices_and_empty_cart.sql | 'Your listing is live', | 'Listing updated',
 * @mutate supabase/migrations/20261028200440_declutter_audit3_notices_and_empty_cart.sql | 'Your listing needs a change', | 'Listing updated',
 * @mutate supabase/migrations/20261028200440_declutter_audit3_notices_and_empty_cart.sql | '" wasn''t approved: ' \|\| v_note, | '" wasn''t approved.',
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIGRATIONS = join(__dirname, "..", "..", "supabase", "migrations");

describe("Q2414: a Declutter listing decision reaches the seller", () => {
  const def = effectiveDefs(MIGRATIONS).get("declutter_admin_review_item");
  const body = blankSqlComments(def?.stmt ?? "");

  it("the newest review function notifies the seller on approve and on reject", () => {
    expect(def, "declutter_admin_review_item is defined").toBeTruthy();
    expect(body).toMatch(/declutter_notify\(v_seller, 'info', 'Your listing is live'/);
    expect(body).toMatch(/declutter_notify\(v_seller, 'info', 'Your listing needs a change'/);
  });

  it("a rejection says why, in the admin's own note", () => {
    expect(body).toMatch(/wasn''t approved: ' \|\| v_note/);
  });

  it("the notices come after the status change, so a refused review tells nobody", () => {
    expect(body.indexOf("declutter_notify(")).toBeGreaterThan(body.indexOf("UPDATE public.declutter_items"));
  });
});
