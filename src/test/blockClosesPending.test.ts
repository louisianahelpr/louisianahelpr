/**
 * Q345 item 2 — a block closes what is still PENDING between the two people.
 *
 * WHAT WAS BROKEN (prod, 2026-09-24): block_user_and_settle settled accepted
 * jobs between the pair, but a pending application or a pending direct offer
 * between them stayed open after the block (one live case, left untouched on
 * purpose: this is new behaviour for future blocks only, no backfill).
 *
 * The EFFECTIVE definitions (latest migration that defines each function) must:
 *   - close pending applications in BOTH seats as rejected / party_blocked;
 *   - decline a pending, answerable direct offer in BOTH directions;
 *   - notify_on_application must return before its notification INSERT for
 *     party_blocked, so the closure sends no notice (or email) to anyone;
 *   - the closed_reason CHECK must admit 'party_blocked', or the settle would
 *     raise and roll the block back.
 * Behavioural proof, red-before/green-after, 3x replay, both seats, with a
 * positive notification control: scripts/probes/block-closes-pending.pglite.mjs.
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG_DIR = join(process.cwd(), "supabase/migrations");
const squash = (s: string) => blankSqlComments(s).replace(/\s+/g, " ").toLowerCase();

describe("Q345: block_user_and_settle closes pending applications and offers", () => {
  const defs = effectiveDefs(MIG_DIR);
  const settle = squash(defs.get("block_user_and_settle")?.stmt ?? "");
  const notify = squash(defs.get("notify_on_application")?.stmt ?? "");

  it("the inventory is real", () => {
    expect(defs.size).toBeGreaterThan(100);
    expect(settle.length).toBeGreaterThan(500);
    expect(notify).toContain("insert into public.notifications");
  });

  it("pending applications close as party_blocked in both seats", () => {
    const m = settle.match(/update public\.applications a set status = 'rejected', closed_reason = 'party_blocked'[^;]*;/);
    expect(m, "no party_blocked close of applications").toBeTruthy();
    const stmt = m?.[0] ?? "";
    expect(stmt).toContain("a.status = 'pending'");
    expect(stmt).toContain("a.helper_id = v_user and j.customer_id = p_blocked");
    expect(stmt).toContain("a.helper_id = p_blocked and j.customer_id = v_user");
  });

  it("a pending direct offer between them is declined in both directions", () => {
    const m = settle.match(/update public\.jobs set direct_offer_status = 'declined'[^;]*;/);
    expect(m, "no offer decline").toBeTruthy();
    const stmt = m?.[0] ?? "";
    expect(stmt).toContain("direct_offer_status = 'pending'");
    expect(stmt).toContain("customer_id = v_user and offered_to_helper_id = p_blocked");
    expect(stmt).toContain("customer_id = p_blocked and offered_to_helper_id = v_user");
  });

  it("notify_on_application skips party_blocked before it writes a notice", () => {
    const rejected = notify.indexOf("new.status = 'rejected' and old.status = 'pending'");
    const skip = notify.search(/if new\.closed_reason = 'party_blocked' then return new; end if;/);
    expect(rejected).toBeGreaterThan(-1);
    expect(skip, "no party_blocked skip").toBeGreaterThan(rejected);
    expect(skip).toBeLessThan(notify.indexOf("insert into public.notifications", rejected));
  });

  it("the latest closed_reason CHECK admits party_blocked", () => {
    let latest = "";
    for (const f of migrationFiles(MIG_DIR)) {
      const sql = squash(readFileSync(join(MIG_DIR, f), "utf8"));
      const m = sql.match(/add constraint applications_closed_reason_check check \(([^;]*)\);/g);
      if (m) latest = m[m.length - 1];
    }
    expect(latest).toContain("'party_blocked'");
  });
});

// The applications close disabled.
// @mutate supabase/migrations/20260924220318_rename_tab_addresses.sql |      AND a.status = 'pending' |      AND false
// The offer decline disabled.
// @mutate supabase/migrations/20260924220318_rename_tab_addresses.sql | direct_offer_expires_at = NULL\n   WHERE direct_offer_status = 'pending' | direct_offer_expires_at = NULL\n   WHERE false
// The notification skip removed.
// @mutate supabase/migrations/20260924220318_rename_tab_addresses.sql |     IF NEW.closed_reason = 'party_blocked' THEN |     IF false THEN
// The constraint not widened.
// @mutate supabase/migrations/20260924023843_block_closes_pending_applications_and_offers.sql |   CHECK (closed_reason IS NULL OR closed_reason IN ('job_cancelled', 'party_blocked')); |   CHECK (closed_reason IS NULL OR closed_reason IN ('job_cancelled'));
