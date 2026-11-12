/**
 * Homes messages, server slice 2 (A-H1 / NOT-LAUNCHED Q2209): a side of a Homes thread reports the OTHER side's
 * message (never their own, never a thread they are not on, never with the rentals switch off), and Download My Data
 * carries each side's threads and messages without the other side's id (42 U.S.C. 3604(c); La. R.S. 51:2606: each
 * side sees only the other's first name). Reads the EFFECTIVE (newest) definitions; behaviour on a real database is
 * src/test/pglite/homesTalkReportExport.pglite.mjs (3x, both worlds, 12 planted defects red).
 *
 * @mutate supabase/migrations/20261106191100_homes_talk_report_and_export.sql |       IF v_htm_side = htm.sender_side THEN |       IF false THEN
 * @mutate supabase/migrations/20261106191100_homes_talk_report_and_export.sql | IF v_htm_side IS NULL OR NOT public.feature_enabled_for('rentals') THEN | IF v_htm_side IS NULL THEN
 * @mutate supabase/migrations/20261112081700_shops_export_rest.sql | ELSE to_jsonb(t) - 'member_id' - 'member_notified_at' | ELSE to_jsonb(t) - 'member_notified_at'
 * @mutate supabase/migrations/20261112081700_shops_export_rest.sql | jsonb_build_object('home_talk_messages', (SELECT coalesce(jsonb_agg(jsonb_build_object( | jsonb_build_object('home_talk_messages', (SELECT coalesce(jsonb_agg(jsonb_build_object('sender_id', t.sender_id,
 */
import { describe, expect, it } from "vitest";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";
import { resolve } from "node:path";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");

/** The home_talk_message branch of the newest report trigger. */
const branch = () => {
  const t = flat("report_message_party_and_copy");
  const start = t.indexOf("IF NEW.reported_type = 'home_talk_message' THEN");
  return start < 0 ? "" : t.slice(start, t.indexOf("RETURN NEW;", start));
};
/** One section of the newest export_my_data, from its jsonb_build_object to the next one. */
const section = (name: string) => {
  const t = flat("export_my_data");
  const start = t.indexOf(`jsonb_build_object('${name}',`);
  return start < 0 ? "" : t.slice(start, t.indexOf("v_out := v_out", start));
};

describe("Homes messages: reports and Download My Data (A-H1 slice 2)", () => {
  it("reads the newest definitions (floor)", () => {
    for (const fn of ["report_message_party_and_copy", "notify_reporter_report_outcome", "export_my_data"]) {
      expect(DEFS.get(fn)?.file ?? "", fn).not.toBe("");
    }
    expect(branch().length).toBeGreaterThan(400);
    expect(section("home_talks").length).toBeGreaterThan(200);
    expect(section("home_talk_messages").length).toBeGreaterThan(200);
  });

  it("only the other side of the thread reports a message, with the switch on; the copy names no one", () => {
    const b = branch();
    expect(b).toContain("v_htm_side := public.home_talk_side(htt.id, NEW.reporter_id);");
    expect(b).toContain("IF v_htm_side IS NULL OR NOT public.feature_enabled_for('rentals') THEN RAISE EXCEPTION 'report_target_not_found'");
    expect(b).toContain("IF v_htm_side = htm.sender_side THEN RAISE EXCEPTION 'report_own_content'");
    expect(b).not.toMatch(/profiles|full_name|first_name/);
    expect(flat("notify_reporter_report_outcome")).toContain("WHEN 'home_talk_message' THEN 'a message'");
  });

  it("the export never hands one side the other's id", () => {
    expect(section("home_talks")).toContain("ELSE to_jsonb(t) - 'member_id' - 'member_notified_at' - 'member_read_at' END");
    expect(section("home_talk_messages")).not.toMatch(/to_jsonb\(t\)|'sender_id'/);
    expect(section("home_talk_messages")).toContain("'mine', t.sender_id IS NOT DISTINCT FROM v_uid,");
  });
});
