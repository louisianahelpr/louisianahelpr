/**
 * The owner gets a text when someone writes to support (10-30). The behaviour runs in
 * src/test/pglite/supportOwnerText.pglite.mjs (migration applied 3x; red with NEW_MIGRATION=skip) and the sender in
 * src/test/edge/sms-alerts.test.ts. This reads the NEWEST definition, so a later restatement can't quietly drop the
 * test skip or the throttle, or put anything typed into the text.
 *
 * @mutate supabase/migrations/20261031012518_support_ticket_owner_text.sql |          public.is_test_subject(v_sender)\n         OR EXISTS | EXISTS
 * @mutate supabase/migrations/20261031012518_support_ticket_owner_text.sql |       WHERE t.last_sent_at <= now() - interval '15 minutes'\n |
 * @mutate supabase/migrations/20261031012518_support_ticket_owner_text.sql |   WHEN (NEW.team_thread_user_id IS NOT NULL AND NEW.sender_id = NEW.team_thread_user_id) |   WHEN (NEW.team_thread_user_id IS NOT NULL)
 * @mutate supabase/functions/_shared/smsPolicy.ts |     : "/admin?view=support"; |     : "/support";
 * @mutate supabase/functions/_shared/smsPolicy.ts |   const path = typeof teamThreadUserId === "string" && UUID_RE.test(teamThreadUserId) |   const path = typeof teamThreadUserId === "string"
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { newestFunction } from "./helpers/parityReaders";
import { blankSqlComments } from "./helpers/blankNonCode";
import { ownerSupportText } from "../../supabase/functions/_shared/smsPolicy";

const MIGRATION = "supabase/migrations/20261031012518_support_ticket_owner_text.sql";
const body = blankSqlComments(newestFunction("notify_owner_support_text").body);
const sql = blankSqlComments(readFileSync(MIGRATION, "utf8"));

describe("the owner's support text", () => {
  it("skips a test, seed or admin sender and a fixture guest before it claims or sends", () => {
    const send = body.indexOf("public.sms_post_to_edge");
    const claim = body.indexOf("INSERT INTO public.support_text_throttle");
    expect(send).toBeGreaterThan(0);
    expect(claim).toBeGreaterThan(0);
    for (const skip of ["public.is_test_subject(v_sender)", "p.is_seed IS TRUE", "r.role = 'admin'", "public.is_fixture_email(v_guest)"]) {
      const at = body.indexOf(skip);
      expect(at, skip).toBeGreaterThan(-1);
      expect(at, skip).toBeLessThan(claim);
    }
  });

  it("one text per conversation per 15 minutes, claimed before it sends", () => {
    expect(body).toMatch(/ON CONFLICT \(conversation_key\) DO UPDATE SET last_sent_at = now\(\)\s+WHERE t\.last_sent_at <= now\(\) - interval '15 minutes'/);
    expect(body.indexOf("IF v_claimed IS NULL THEN")).toBeLessThan(body.indexOf("public.sms_post_to_edge"));
  });

  it("sends only a fixed payload: nothing anyone typed", () => {
    expect(body).toContain("public.sms_post_to_edge(jsonb_strip_nulls(jsonb_build_object('owner_support_text', true, 'team_thread_user_id', v_thread)))");
    const send = body.slice(body.indexOf("PERFORM public.sms_post_to_edge"), body.indexOf("EXCEPTION"));
    expect(send).not.toMatch(/NEW\.|v_guest|v_sender/);
  });

  it("the text is the fixed words and a link, in one segment", () => {
    const uuid = "AAAAAAAA-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(ownerSupportText("https://www.louisianahelpr.com/")).toBe("New Helpr support message https://www.louisianahelpr.com/admin?view=support");
    const thread = ownerSupportText("https://www.louisianahelpr.com/", uuid);
    expect(thread).toBe(`New Helpr support message https://www.louisianahelpr.com/messages?teamThread=${uuid.toLowerCase()}`);
    expect(thread.length).toBeLessThan(160);
    expect(ownerSupportText("https://www.louisianahelpr.com", "not a uuid&x=1")).toBe("New Helpr support message https://www.louisianahelpr.com/admin?view=support");
  });

  it("every way into the inbox has a trigger, and a failure can't fail the message", () => {
    expect(sql).toMatch(/AFTER INSERT ON public\.reports\s+FOR EACH ROW\s+WHEN \(NEW\.reported_type = 'support'\)/);
    expect(sql).toMatch(/AFTER INSERT ON public\.messages\s+FOR EACH ROW\s+WHEN \(NEW\.team_thread_user_id IS NOT NULL AND NEW\.sender_id = NEW\.team_thread_user_id\)/);
    expect(body).toMatch(/EXCEPTION WHEN OTHERS THEN\s+INSERT INTO public\.error_logs/);
  });

  it("only the service role can run it", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.notify_owner_support_text\(\) FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.sms_claim_owner_support\(boolean, text\) FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.support_text_throttle FROM PUBLIC, anon, authenticated/);
  });
});
