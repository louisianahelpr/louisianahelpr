import { describe, expect, it } from "vitest";
import { resolve } from "node:path";

import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

/**
 * The poster's ID notice reaches no test data (owner: test data never reaches the
 * owner or anyone else). The notifier runs from the payout-setup-reminders cron with
 * no signed-in member, so the notification gate's caller check cannot catch it: the
 * function must skip test data itself.
 *
 * Behaviour (red before, 3x replay, real jobs still told):
 * src/test/pglite/idNoticeSkipsTestData.pglite.mjs.
 */
// @mutate supabase/migrations/20261031221530_id_notice_skips_test_data_restated.sql |        AND h.job_seed IS NOT TRUE\n |
// @mutate supabase/migrations/20261031221530_id_notice_skips_test_data_restated.sql |        AND NOT public.is_test_subject(h.customer_id)\n |
// @mutate supabase/migrations/20261031221530_id_notice_skips_test_data_restated.sql |        AND NOT public.is_test_subject(h.uid)\n |

const DEFS = effectiveDefs(resolve(__dirname, "..", "..", "supabase", "migrations"));

describe("the ID notice skips test data", () => {
  const def = DEFS.get("identity_notify_posters_before_start");
  const body = blankSqlComments(def?.stmt ?? "");

  it("reads the newest definition", () => {
    expect(def).toBeDefined();
    expect(body.length).toBeGreaterThan(200);
    expect(body).toMatch(/INSERT\s+INTO\s+public\.notifications/i);
  });

  it("skips a seed job, and a test subject on either side, before it writes", () => {
    const due = /\bdue\s+AS\s*\(([\s\S]*?)\),\s*ins\s+AS/i.exec(body)?.[1] ?? "";
    expect(due.length).toBeGreaterThan(100);
    expect(due).toMatch(/\bh\.job_seed\s+IS\s+NOT\s+TRUE/i);
    expect(due).toMatch(/NOT\s+public\.is_test_subject\(h\.customer_id\)/i);
    expect(due).toMatch(/NOT\s+public\.is_test_subject\(h\.uid\)/i);
  });

  it("both arms of the hire list carry the job's seed flag", () => {
    const hired = /\bhired\s+AS\s*\(([\s\S]*?)\),\s*due\s+AS/i.exec(body)?.[1] ?? "";
    const arms = hired.split(/UNION\s+ALL/i);
    expect(arms).toHaveLength(2);
    for (const arm of arms) expect(arm).toMatch(/\bj\.is_seed\b/i);
  });
});
