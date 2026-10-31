/**
 * Owner 2026-10-27 (screenshot of the bell): "Stop showing test stuff in my
 * notification". Fixtures create a user already confirmed, so the admin
 * "New member joined" notice fires before they PATCH is_seed = true. When an
 * account is marked a test account, its notice is taken back from every admin.
 *
 * @mutate supabase/migrations/20261031205315_account_deletion_count_in_daily_summary.sql |   IF NEW.is_seed IS TRUE AND OLD.is_seed IS DISTINCT FROM TRUE THEN |   IF false THEN
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";
import { readFileSync } from "node:fs";

const MIG = join(__dirname, "..", "..", "supabase", "migrations");
const defs = effectiveDefs(MIG);

describe("admin new-member notice about a test account is taken back", () => {
  it("marking an account a test account deletes its admin join notice", () => {
    const body = blankSqlComments(defs.get("retract_new_member_notice_for_test_account")?.stmt ?? "");
    expect(body).toMatch(/IF NEW\.is_seed IS TRUE AND OLD\.is_seed IS DISTINCT FROM TRUE THEN\s+DELETE FROM public\.notifications/);
    expect(body).toMatch(/n\.link = '\/admin\?view=people&user=' \|\| NEW\.user_id::text/);
  });

  it("the trigger fires on is_seed updates of profiles", () => {
    const sql = readFileSync(join(MIG, "20261027220459_admin_new_member_notice_retracted_when_marked_test.sql"), "utf8");
    expect(sql).toMatch(/AFTER UPDATE OF is_seed ON public\.profiles\s+FOR EACH ROW EXECUTE FUNCTION public\.retract_new_member_notice_for_test_account\(\)/);
  });
});
