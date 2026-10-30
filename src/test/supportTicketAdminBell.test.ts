/**
 * Every new support ticket rings every admin's bell (10-30). The behaviour runs in
 * src/test/pglite/supportTicketAdminBell.pglite.mjs (migration applied 3x; red with NEW_MIGRATION=skip). This reads the
 * NEWEST definition, so a later restatement cannot quietly drop the test skip or put typed text in the bell.
 *
 * @mutate supabase/migrations/20261030212558_support_ticket_admin_bell.sql |          public.is_test_subject(NEW.reporter_id)\n         OR EXISTS |          EXISTS
 * @mutate supabase/migrations/20261030212558_support_ticket_admin_bell.sql |      WHERE ur.user_id IS DISTINCT FROM NEW.reporter_id; |      WHERE true;
 * @mutate supabase/migrations/20261030212558_support_ticket_admin_bell.sql |   WHEN (NEW.reported_type = 'support') |   WHEN (NEW.reported_type <> 'support')
 * @mutate supabase/migrations/20261030212558_support_ticket_admin_bell.sql | 'A member wrote to support.' | NEW.reason
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { newestFunction } from "./helpers/parityReaders";
import { blankSqlComments } from "./helpers/blankNonCode";

const fn = newestFunction("notify_admins_support_ticket");
const body = blankSqlComments(fn.body);

describe("a new support ticket rings the admins' bell", () => {
  it("skips a test or seed reporter before it writes anything", () => {
    const skip = body.indexOf("public.is_test_subject(NEW.reporter_id)");
    expect(skip).toBeGreaterThan(-1);
    expect(body).toMatch(/p\.is_seed IS TRUE/);
    expect(skip).toBeLessThan(body.indexOf("INSERT INTO public.notifications"));
  });

  it("the bell carries nothing anyone typed", () => {
    const insert = body.slice(body.indexOf("INSERT INTO public.notifications"), body.indexOf("EXCEPTION"));
    expect(insert.length).toBeGreaterThan(100);
    expect(insert).not.toMatch(/NEW\.(reason|description|reported_content)/);
  });

  it("the trigger fires only for support tickets", () => {
    const sql = blankSqlComments(readFileSync("supabase/migrations/20261030212558_support_ticket_admin_bell.sql", "utf8"));
    expect(sql).toMatch(/AFTER INSERT ON public\.reports\s+FOR EACH ROW\s+WHEN \(NEW\.reported_type = 'support'\)/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.notify_admins_support_ticket\(\) FROM PUBLIC, anon, authenticated/);
  });
});
