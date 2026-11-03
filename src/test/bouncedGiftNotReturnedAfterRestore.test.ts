/**
 * Q2077: a job's gift is given back to the poster ONCE. restore_gift_card_for_job gives it back by minting a new row
 * (restored_from_job_id = the job) and leaves the original 'redeemed' on the job; return_bounced_gift_card put the
 * original back to 'sent' without looking for that row, so a job that reached both left the poster holding it twice.
 *
 * Class: every effective SQL function (newest definition, rewrites included) that puts a gift card back to 'sent'
 * (UPDATE public.gift_cards SET status = 'sent') checks restored_from_job_id BEFORE that write. And the webhook treats
 * return_bounced_gift_card's 'already_restored' as "nothing to do" in both of its callers (no page, no notice): the
 * behaviour is in src/test/edge/fundedJobPaymentFailed.test.ts and src/test/edge/stripe-webhook.test.ts.
 * Behaviour (real Postgres, base = prod's live definition by md5):
 * src/test/pglite/bouncedGiftNotReturnedAfterRestore.pglite.mjs (11 PASS; 3 FAIL on prod's definition).
 *
 * @mutate supabase/migrations/20261103011045_bounced_gift_not_returned_after_restore.sql |   IF EXISTS (SELECT 1 FROM public.gift_cards g WHERE g.restored_from_job_id = p_job_id) THEN\n    RETURN jsonb_build_object('outcome', 'already_restored', 'credit_id', p_gift_card_id);\n  END IF;\n |
 * @mutate supabase/migrations/20261103011045_bounced_gift_not_returned_after_restore.sql | WHERE g.restored_from_job_id = p_job_id) THEN | WHERE g.parent_credit_id = p_gift_card_id) THEN
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

describe("Q2077: a job's gift is given back once", () => {
  it("every function that puts a gift back to 'sent' checks for a minted replacement first", () => {
    const writers: string[] = [];
    const offenders: string[] = [];
    for (const [name, def] of effectiveDefs("supabase/migrations")) {
      const body = blankSqlComments(def.stmt).replace(/\s+/g, " ");
      const write = body.search(/UPDATE public\.gift_cards SET status = 'sent'/i);
      if (write < 0) continue;
      writers.push(name);
      const guard = body.search(/WHERE (?:\w+\.)?restored_from_job_id = p_job_id/);
      if (guard < 0 || guard > write) offenders.push(`${name} (${def.file})`);
    }
    // Inventory floor: restore_gift_card_for_job and return_bounced_gift_card.
    expect(writers.sort()).toEqual(expect.arrayContaining(["restore_gift_card_for_job", "return_bounced_gift_card"]));
    expect(writers.length).toBeGreaterThan(1);
    expect(offenders).toEqual([]);
  });

  it("return_bounced_gift_card answers already_restored after the gift is found, before the job's gates", () => {
    const d = effectiveDefs("supabase/migrations").get("return_bounced_gift_card");
    expect(d).toBeTruthy();
    const body = blankSqlComments(d!.stmt).replace(/\s+/g, " ");
    const found = body.indexOf("RETURN jsonb_build_object('outcome', 'not_consumed', 'credit_id', p_gift_card_id);");
    const restored = body.indexOf(
      "IF EXISTS (SELECT 1 FROM public.gift_cards g WHERE g.restored_from_job_id = p_job_id) THEN RETURN jsonb_build_object('outcome', 'already_restored', 'credit_id', p_gift_card_id); END IF;",
    );
    const gates = body.indexOf("IF v_job.payment_status IS DISTINCT FROM 'failed' THEN");
    expect(found).toBeGreaterThan(-1);
    expect(restored).toBeGreaterThan(found);
    expect(gates).toBeGreaterThan(restored);
  });

  it("the webhook maps already_restored to nothing to do in both callers", () => {
    const src = blankComments(readFileSync("supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts", "utf8"));
    expect(src).toContain('gift?.outcome !== "not_consumed" && gift?.outcome !== "already_restored"');
    expect(src).toContain('if (outcome === "not_consumed" || outcome === "already_restored") return "none";');
  });
});
