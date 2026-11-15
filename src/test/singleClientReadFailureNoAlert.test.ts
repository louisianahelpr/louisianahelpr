/**
 * Q2780 (lead 11-14, decided by recommendation; LEAD-LOG.md, OWNER-DECISIONS): no owner-facing alert for one stalled
 * client, an alert only on a repeated pattern. Ledger dd2ccbc600ce ("/ · error screen shown: couldn't load the newest
 * jobs.") was opened by three guest rows over five days.
 *
 * A guest has no per-client id (guest_fp is md5 of message and path, 20261012145240), so the newest
 * ops_alert_record_user_error_screen gates ONLY the public low-stakes read surfaces (LiveJobsSection, BootWatchdog):
 * a NEW item opens on 3 rows in 24 hours or 2 distinct members (the rule as set 2026-11-14). Every other surface (money, disputes, admin queues,
 * crashes) still opens on first sight. Behaviour proven in PGlite (src/test/pglite/singleClientReadFailureNoAlert.pglite.mjs);
 * this guard keeps the newest definition carrying exactly that gate.
 *
 * @mutate supabase/migrations/20261115001106_single_client_read_failure_no_alert.sql |       IF v_rows < 3 AND v_members < 2 THEN RETURN NULL; END IF; |       IF v_rows < 30 THEN RETURN NULL; END IF;
 * @mutate supabase/migrations/20261115001106_single_client_read_failure_no_alert.sql |     IF v_surface IN ('LiveJobsSection', 'BootWatchdog') THEN |     IF v_norm ~ 'couldn.?t load' OR v_surface = 'BootWatchdog' THEN
 * @mutate supabase/migrations/20261115001106_single_client_read_failure_no_alert.sql |       SELECT count(*), count(DISTINCT x.user_id) INTO v_rows, v_members FROM ( |       SELECT count(*), count(*) INTO v_rows, v_members FROM (
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const def = effectiveDefs(join(process.cwd(), "supabase", "migrations")).get("ops_alert_record_user_error_screen");
const body = blankSqlComments(def?.stmt ?? "").replace(/\s+/g, " ");

describe("Q2780: one person's failed public read opens no alert; a pattern does", () => {
  it("reads the newest definition (floor)", () => {
    expect(def?.file).toBe("20261115001106_single_client_read_failure_no_alert.sql");
    expect(body.length).toBeGreaterThan(2000);
  });

  it("gates exactly the two public low-stakes surfaces, never a title pattern", () => {
    expect(body).toContain("IF v_surface IN ('LiveJobsSection', 'BootWatchdog') THEN");
    expect(body).not.toMatch(/couldn\.\?t load/);
  });

  it("opens on 3 rows in 24 hours or 2 distinct members, with a bounded scan", () => {
    const gate = body.indexOf("IF v_surface IN ('LiveJobsSection', 'BootWatchdog') THEN");
    const block = body.slice(gate, body.indexOf("END IF; END IF;", gate) + "END IF;".length);
    expect(block).toContain("SELECT count(*), count(DISTINCT x.user_id) INTO v_rows, v_members");
    expect(block).toContain("e.created_at > v_seen - interval '24 hours'");
    expect(block).toContain("LIMIT 50");
    expect(block).toContain("IF v_rows < 3 AND v_members < 2 THEN RETURN NULL; END IF;");
  });

  it("the gate sits in the NEW-item branch, before the repeat branch", () => {
    const gate = body.indexOf("IF v_rows < 3");
    const opens = body.indexOf("IF NOT EXISTS (SELECT 1 FROM public.ops_alert_ledger");
    const repeats = body.indexOf("v_repeat_cap := CASE");
    expect(opens).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(opens);
    expect(repeats).toBeGreaterThan(gate);
  });
});
