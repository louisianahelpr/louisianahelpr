/**
 * Q2274 (HIGH; lh-authz-rls finding on Q2267): the export a SELLER downloads never names the buyer of an offer that
 * did not become a sale. An "I have this" answer to a Wanted post (20261021031757) would otherwise hand the seller the
 * poster's user id; declutter_my_offers returns no counterparty id for the same reason. Read from the definition the
 * database runs (effectiveDefs, comments blanked).
 *
 * @mutate supabase/migrations/20261031231948_helpr_delivery_talk.sql | THEN to_jsonb(t) - 'buyer_id' ELSE to_jsonb(t) END) | THEN to_jsonb(t) ELSE to_jsonb(t) END)
 * @mutate supabase/migrations/20261031231948_helpr_delivery_talk.sql | AND t.status <> 'accepted' | AND true
 * @mutate supabase/migrations/20261031231948_helpr_delivery_talk.sql | ELSE to_jsonb(t) - 'asker_id' END) | ELSE to_jsonb(t) END)
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = path.resolve(__dirname, "../../supabase/migrations");
const flat = (s: string) => s.replace(/\s+/g, " ");

describe("Q2274: the seller's export hides the buyer of an unsold offer", () => {
  it("the declutter_offers section drops buyer_id on the seller side unless the offer was accepted", () => {
    const def = effectiveDefs(DIR).get("export_my_data");
    expect(def, "export_my_data is defined").toBeTruthy();
    const body = flat(blankSqlComments(def!.stmt));
    const at = body.indexOf("jsonb_build_object('declutter_offers'");
    expect(at).toBeGreaterThan(0);
    const section = body.slice(at, body.indexOf("jsonb_build_object('declutter_orders'", at));
    expect(section).toContain("CASE WHEN t.seller_id = v_uid AND t.buyer_id IS DISTINCT FROM v_uid AND t.status <> 'accepted' THEN to_jsonb(t) - 'buyer_id' ELSE to_jsonb(t) END");
    expect(section).toContain("WHERE t.buyer_id = v_uid OR t.seller_id = v_uid");
  });

  it("Q2278: questions on the caller's items asked by someone else drop asker_id; the asker's own keep it", () => {
    const body = flat(blankSqlComments(effectiveDefs(DIR).get("export_my_data")!.stmt));
    const at = body.indexOf("jsonb_build_object('declutter_questions'");
    expect(at).toBeGreaterThan(0);
    expect(body.slice(at, at + 400)).toContain("CASE WHEN t.asker_id = v_uid THEN to_jsonb(t) ELSE to_jsonb(t) - 'asker_id' END");
  });
});
