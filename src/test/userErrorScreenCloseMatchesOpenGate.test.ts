/**
 * Q2806 (follow-up to Q2780; lead lexilombas-7b, 2026-11-15): the close question for an open LiveJobsSection /
 * BootWatchdog error-screen item asks what the open gate asks. 20261115001106 opens such an item only on 3 rows in
 * 24 hours or 2 distinct members; the 'user-error-screen' branch of ops_alert_condition read ANY one row in 24 hours
 * as "still failing", so one link-scanner hit a day kept an item open that one hit could never have opened.
 *
 * Behaviour proven in PGlite (src/test/pglite/userErrorScreenCloseMatchesOpenGate.pglite.mjs, red on the state
 * before it); this guard keeps the newest ops_alert_condition carrying exactly that rule, for those two surfaces only.
 *
 * @mutate supabase/migrations/20261115073221_user_error_screen_close_matches_open_gate.sql |       IF v_ues_rows >= 3 OR v_ues_members >= 2 THEN RETURN true; END IF; |       IF v_ues_rows >= 1 THEN RETURN true; END IF;
 * @mutate supabase/migrations/20261115073221_user_error_screen_close_matches_open_gate.sql |     IF p_sample_ref ->> 'surface' IN ('LiveJobsSection', 'BootWatchdog') THEN |     IF p_sample_ref ->> 'surface' IS NOT NULL THEN
 * @mutate supabase/migrations/20261115073221_user_error_screen_close_matches_open_gate.sql |       SELECT count(*), count(DISTINCT x.user_id) INTO v_ues_rows, v_ues_members FROM ( |       SELECT count(*), count(*) INTO v_ues_rows, v_ues_members FROM (
 * @mutate supabase/migrations/20261115073221_user_error_screen_close_matches_open_gate.sql |            AND e.tags ->> 'source' = p_sample_ref ->> 'surface' |            AND true
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const MIG = join(process.cwd(), "supabase", "migrations");
const close = effectiveDefs(MIG).get("ops_alert_condition");
const open = effectiveDefs(MIG).get("ops_alert_record_user_error_screen");
const flat = (s: string | undefined) => blankSqlComments(s ?? "").replace(/\s+/g, " ");
const body = flat(close?.stmt);
const openBody = flat(open?.stmt);

/** The user-error-screen branch, up to the next dispatcher branch. */
function branch(): string {
  const at = body.indexOf("ELSIF p_source = 'user-error-screen' THEN");
  return body.slice(at, body.indexOf("ELSIF p_source", at + 10));
}

describe("Q2806: an open public-read error-screen item closes on the same rule that opens it", () => {
  it("reads the newest definitions (floor)", () => {
    expect(close?.file).toBe("20261115073221_user_error_screen_close_matches_open_gate.sql");
    expect(body.length).toBeGreaterThan(6000);
    expect(branch().length).toBeGreaterThan(500);
  });

  it("the close rule gates exactly the surfaces the open gate gates", () => {
    const surfaces = (s: string) => s.match(/IN \('LiveJobsSection', 'BootWatchdog'\)/g)?.length ?? 0;
    expect(surfaces(openBody)).toBe(1);
    expect(branch()).toContain("IF p_sample_ref ->> 'surface' IN ('LiveJobsSection', 'BootWatchdog') THEN");
  });

  it("still failing only on 3 rows in 24 hours or 2 distinct members of that screen and surface, bounded", () => {
    const b = branch();
    const gate = b.indexOf("IF p_sample_ref ->> 'surface' IN");
    const block = b.slice(gate, b.indexOf("ELSIF EXISTS", gate));
    expect(block).toContain("SELECT count(*), count(DISTINCT x.user_id) INTO v_ues_rows, v_ues_members");
    expect(block).toContain("e.created_at > now() - interval '24 hours'");
    expect(block).toContain("AND e.tags ->> 'source' = p_sample_ref ->> 'surface'");
    expect(block).toContain("= p_sample_ref ->> 'title_norm'");
    expect(block).toContain("LIMIT 50");
    expect(block).toContain("IF v_ues_rows >= 3 OR v_ues_members >= 2 THEN RETURN true; END IF;");
    // The open gate's numbers, so the two cannot drift apart unnoticed.
    expect(openBody).toContain("IF v_rows < 3 AND v_members < 2 THEN RETURN NULL; END IF;");
  });

  it("every other surface still reads one real row as failing, and the press-probe half still follows", () => {
    const b = branch();
    expect(b).toMatch(/ELSIF EXISTS \( SELECT 1 FROM public\.error_logs e WHERE e\.created_at > now\(\) - interval '24 hours'/);
    expect(b.indexOf("ops_route_probe")).toBeGreaterThan(b.indexOf("ELSIF EXISTS"));
  });
});
