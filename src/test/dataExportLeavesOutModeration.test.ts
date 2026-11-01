/**
 * A3-I6 (owner decision 2026-10-29): "Download My Data" leaves out the
 * moderation and internal tables. The audit found the export handing a member
 * helper_shadowbans, admin_user_notes, fraud_flags and error_logs rows; the
 * lead confirmed declutter_seller_flags, ops_alert_admin_subjects and
 * verification_exceptions are moderation tables too (application_rate_log and
 * profile_search_rate_log stay: the member's own activity).
 *
 * Reads the NEWEST export_my_data (any dollar-quote tag, comments blanked, via
 * latestFunctionDefs) and fails if it reads any of them, and checks each one
 * is exempt in the inventory with a reason that cites the law relied on.
 * dataExportCoversEveryUserTable keeps the rest of the export two-way.
 */
// @mutate supabase/migrations/20261031231948_helpr_delivery_talk.sql |   v_out := v_out \|\| jsonb_build_object('payout_holds', |   v_out := v_out \|\| jsonb_build_object('fraud_flags', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.fraud_flags t WHERE t.user_id = v_uid));\n  v_out := v_out \|\| jsonb_build_object('payout_holds',
// @mutate supabase/migrations/20261031231948_helpr_delivery_talk.sql |   v_out := v_out \|\| jsonb_build_object('payout_holds', |   v_out := v_out \|\| jsonb_build_object('notes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.admin_user_notes t WHERE t.user_id = v_uid));\n  v_out := v_out \|\| jsonb_build_object('payout_holds',
// @mutate supabase/migrations/20261031231948_helpr_delivery_talk.sql |   v_out := v_out \|\| jsonb_build_object('favorite_helpers', |   v_out := v_out \|\| jsonb_build_object('ops_alert_admin_subjects', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.ops_alert_admin_subjects t WHERE t.user_id = v_uid));\n  v_out := v_out \|\| jsonb_build_object('favorite_helpers',
// @mutate src/test/helpers/dataExportInventory.ts |   "helper_shadowbans.helper_id": { reason: "A3-I6 (owner 2026-10-29): whether a Helpr is quietly hidden from search, a moderation tool that works only while unannounced, Cal. Code Regs. tit. 11, s. 7024(d) and GDPR Art. 23(1)(d)" }, |   "helper_shadowbans.helper_id": { reason: "staff tool" },
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { latestFunctionDefs } from "./helpers/rpcErrorInventory";
import { EXEMPT, EXPORTED } from "./helpers/dataExportInventory";
import { EXPORT_SECTIONS } from "../../scripts/lib/privacyJourney.mjs";

/** Table -> the person column the inventory exempts it by. */
const LEFT_OUT: Record<string, string> = {
  helper_shadowbans: "helper_id",
  admin_user_notes: "user_id",
  fraud_flags: "user_id",
  error_logs: "user_id",
  // Lead-confirmed 2026-10-29 as part of the owner's "moderation tables".
  declutter_seller_flags: "user_id",
  ops_alert_admin_subjects: "user_id",
  verification_exceptions: "user_id",
};

const defs = latestFunctionDefs(join(process.cwd(), "supabase", "migrations"));
const newest = defs.get("export_my_data");

describe("A3-I6: Download My Data leaves out the moderation tables", () => {
  it("reads the newest export_my_data (floor)", () => {
    expect(newest?.file ?? "").toMatch(/\.sql$/);
    expect((newest?.body ?? "").length).toBeGreaterThan(20_000);
    expect(newest?.body).toMatch(/FROM public\.payout_holds t/);
  });

  it("the newest export_my_data reads none of them", () => {
    const body = newest?.body ?? "";
    const read = Object.keys(LEFT_OUT).filter((t) => new RegExp(`\\bpublic\\.${t}\\b`).test(body));
    expect(read, `export_my_data (${newest?.file}) still exports these`).toEqual([]);
  });

  it("each is exempt in the inventory, citing the law, and in no export section list", () => {
    for (const [table, col] of Object.entries(LEFT_OUT)) {
      expect(EXPORTED[table], `${table} is still listed as EXPORTED`).toBeUndefined();
      const reason = EXEMPT[`${table}.${col}`]?.reason ?? "";
      expect(reason, `${table}.${col} needs an EXEMPT reason`).toMatch(/A3-I6/);
      expect(reason, `${table}.${col} must cite the law relied on`).toMatch(/Cal\. Code Regs\. tit\. 11, s\. 7024\(d\)/);
      expect(EXPORT_SECTIONS as readonly string[]).not.toContain(table);
    }
  });
});
