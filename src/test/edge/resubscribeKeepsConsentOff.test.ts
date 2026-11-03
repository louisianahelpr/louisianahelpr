/**
 * Q2092 (owner, 2026-10-15, pop-up: "Only undo what they
 * turned off") and Q2159 (lh-authz-rls review of resubscribe v3 and v4).
 * Resubscribe on the /unsubscribe page restores just what the unsubscribe
 * turned off; promotional (marketing) consent stays OFF unless the person had
 * agreed to it before, and a later change in Settings always wins over an old
 * email.
 *
 * Q2159, the bug: the undo record (profiles.promotions_before_unsubscribe)
 * survived a later change in Settings, and the 'untouched' check only asked
 * whether both flags were off NOW. A member who unsubscribed through a link,
 * then turned consent back on and off again in Settings, had it re-granted by
 * a Resubscribe from the old email. Migration 20261102063312:
 *   - any change to either flag that is not the link's own write clears the
 *     record (two triggers; the link's writes carry app.promotions_undo_write);
 *   - the opt-out and the undo are each ONE RPC (rows locked FOR UPDATE), so
 *     the untouched check and the writes are atomic.
 *
 * Behaviour, red then green: src/test/pglite/promotionsUndoRecordCleared.pglite.mjs
 * (37/37 with the migration applied 3x; 27 FAIL on main's schema, including
 * "a Settings change to consent clears the undo record"). Here:
 *   - the edge function makes ONE call per direction and writes nothing else
 *     itself; a failed opt-out RPC still turns both flags off directly; a
 *     failed undo fails the request and writes nothing;
 *   - Q2160: the newest 'Users can insert their own profile' policy pins the
 *     record to NULL (Q2159's triggers fire on UPDATE only, so a record
 *     arriving by a client INSERT would otherwise survive). Behaviour, red
 *     then green: src/test/pglite/profileInsertPinsUndoRecord.pglite.mjs
 *     (18/18; 3 FAIL on main's policy);
 *   - the newest definitions in the migrations keep each rule (static, so each
 *     mutation registered below can be shown red).
 */
// The undo (promotions_resubscribe).
// @mutate supabase/migrations/20261103091013_shops_promotions_team_message_not_found_is_404.sql | RETURN 'nothing_to_undo';\n  END IF;\n\n  SELECT np.email_promotions INTO v_promo | NULL;\n  END IF;\n\n  SELECT np.email_promotions INTO v_promo
// @mutate supabase/migrations/20261103091013_shops_promotions_team_message_not_found_is_404.sql | SET marketing_consent = (v_saved ->> 'marketing_consent')::boolean IS TRUE, | SET marketing_consent = true,
// @mutate supabase/migrations/20261103091013_shops_promotions_team_message_not_found_is_404.sql | IF (v_saved ->> 'email_promotions')::boolean IS DISTINCT FROM false THEN | IF true THEN
// @mutate supabase/migrations/20261103091013_shops_promotions_team_message_not_found_is_404.sql | SET email_promotions = CASE WHEN (v_saved ->> 'email_promotions')::boolean THEN true END | SET email_promotions = true
// @mutate supabase/migrations/20261103091013_shops_promotions_team_message_not_found_is_404.sql | v_untouched := FOUND AND v_consent IS FALSE AND v_promo IS FALSE; | v_untouched := true;
// The opt-out (promotions_unsubscribe).
// @mutate supabase/migrations/20261103091013_shops_promotions_team_message_not_found_is_404.sql | IF v_saved IS NOT NULL AND NOT (v_consent IS TRUE OR v_promo IS TRUE) THEN | IF v_saved IS NOT NULL AND NOT (v_consent IS TRUE OR v_promo IS NOT FALSE) THEN
// @mutate supabase/migrations/20261103091013_shops_promotions_team_message_not_found_is_404.sql | IF v_saved IS NOT NULL AND NOT (v_consent IS TRUE OR v_promo IS TRUE) THEN | IF v_saved IS NOT NULL THEN
// @mutate supabase/migrations/20261103091013_shops_promotions_team_message_not_found_is_404.sql | IF v_saved IS NOT NULL AND NOT (v_consent IS TRUE OR v_promo IS TRUE) THEN | IF false THEN
// @mutate supabase/migrations/20261103091013_shops_promotions_team_message_not_found_is_404.sql | v_record := jsonb_build_object('marketing_consent', v_consent IS TRUE, | v_record := jsonb_build_object('marketing_consent', true,
// @mutate supabase/migrations/20261103091013_shops_promotions_team_message_not_found_is_404.sql | v_promo := true;\n  END IF;\n\n  v_record | v_promo := false;\n  END IF;\n\n  v_record
// @mutate supabase/migrations/20261103091013_shops_promotions_team_message_not_found_is_404.sql | PERFORM set_config('app.promotions_undo_write', '1', true);\n  UPDATE public.profiles\n     SET marketing_consent = false, | UPDATE public.profiles\n     SET marketing_consent = false,
// @mutate supabase/migrations/20261103091013_shops_promotions_team_message_not_found_is_404.sql |    WHERE p.user_id = p_user_id\n     FOR UPDATE;\n  IF NOT FOUND THEN\n    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'PT404';\n  END IF;\n\n  SELECT np.email_promotions INTO v_promo\n    FROM public.notification_preferences np\n   WHERE np.user_id = p_user_id\n     FOR UPDATE;\n  v_has_row |    WHERE p.user_id = p_user_id;\n  IF NOT FOUND THEN\n    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'PT404';\n  END IF;\n\n  SELECT np.email_promotions INTO v_promo\n    FROM public.notification_preferences np\n   WHERE np.user_id = p_user_id\n     FOR UPDATE;\n  v_has_row
// The record is cleared by any other change.
// @mutate supabase/migrations/20261102063312_promotions_undo_record_cleared.sql |     NEW.promotions_before_unsubscribe := NULL;\n  END IF;\n  RETURN NEW; |     NULL;\n  END IF;\n  RETURN NEW;
// @mutate supabase/migrations/20261102063312_promotions_undo_record_cleared.sql |   AFTER INSERT OR UPDATE OF email_promotions ON public.notification_preferences |   AFTER INSERT ON public.notification_preferences
// @mutate supabase/migrations/20261102063312_promotions_undo_record_cleared.sql |        SET promotions_before_unsubscribe = NULL\n     WHERE user_id = NEW.user_id\n       AND promotions_before_unsubscribe IS NOT NULL; |        SET full_name = full_name\n     WHERE user_id = NEW.user_id\n       AND promotions_before_unsubscribe IS NOT NULL;
// @mutate supabase/migrations/20261103091013_shops_promotions_team_message_not_found_is_404.sql | REVOKE ALL ON FUNCTION public.promotions_resubscribe(uuid) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.promotions_resubscribe(uuid) FROM PUBLIC;
// @mutate supabase/migrations/20261103091013_shops_promotions_team_message_not_found_is_404.sql | REVOKE ALL ON FUNCTION public.promotions_unsubscribe(uuid) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.promotions_unsubscribe(uuid) FROM PUBLIC;
// A client INSERT may not carry a record (Q2160).
// @mutate supabase/migrations/20261102071347_pin_promotions_undo_on_profile_insert.sql |     AND is_seed = false\n    AND promotions_before_unsubscribe IS NULL\n |     AND is_seed = false\n
// @mutate supabase/migrations/20261102071347_pin_promotions_undo_on_profile_insert.sql |     AND promotions_before_unsubscribe IS NULL\n |     OR promotions_before_unsubscribe IS NULL\n
// The edge function.
// @mutate supabase/functions/email-unsubscribe/index.ts |     if (error) throw new Error(`resubscribe failed: ${error.message}`) |     if (error) return
// @mutate supabase/functions/email-unsubscribe/index.ts |   console.error('[email-unsubscribe] promotions_unsubscribe failed; opting out without a record:', rpcError.message) |   throw new Error(rpcError.message)
// @mutate supabase/functions/email-unsubscribe/index.ts |   if (!rpcError) return\n |   if (!rpcError) { await writeEmailPromotions(supabase, userId, true); return }\n
// @mutate supabase/functions/email-unsubscribe/index.ts |     const { error } = await supabase.rpc('promotions_resubscribe', { p_user_id: userId }) |     const { error } = await supabase.rpc('promotions_resubscribe', { p_user_id: userId }); await writeEmailPromotions(supabase, userId, true)
// @mutate supabase/migrations/20261102092917_phone_locked_against_grant_sync.sql |     'promotions_before_unsubscribe',\n    -- ADDED 20261102092917 |     'auto_suspended_until_x',\n    -- ADDED 20261102092917
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { resetEmailMocks } from "./mocks/email";
import { sendUnsubscribeChoice as postUnsubscribe, type UnsubscribeLink } from "@/lib/emailUnsubscribe";
import { effectiveDefs, migrationFiles } from "../helpers/effectiveFunctionDefs";
import { blankSqlComments } from "../helpers/blankNonCode";

type UnsubscribeAction = "unsubscribe" | "resubscribe";

const BASE = "https://x.supabase.co";
const MEMBER = "member-1";
const link: UnsubscribeLink = { e: "member@example.com", sig: "ok-promotions", list: "promotions" };

let fn: EdgeHarness;
const post = (action: UnsubscribeAction) =>
  postUnsubscribe(BASE, link, action, (async (i: RequestInfo | URL, n?: RequestInit) => fn.fetch(new Request(i, n))) as typeof fetch);
const consentWrites = () => scenario.writes.filter((w) => w.table !== "signup_leads");
const calls = (name: string) => (scenario.rpcCalls ?? []).filter((c) => c.name === name);

describe("the edge function: one call per direction, nothing else written", () => {
  beforeEach(async () => {
    resetSupabaseMock();
    resetSharedMocks();
    resetEmailMocks();
    resetEnv();
    scenario.reads.signup_leads = { rows: [] };
    scenario.reads.profiles = { rows: [{ user_id: MEMBER, marketing_consent: true }] };
    scenario.reads.notification_preferences = { rows: [{ user_id: MEMBER, email_promotions: true }] };
    setEnv({ SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "service-key", CRON_SECRET: "c" });
    fn = await loadEdgeFunction("email-unsubscribe");
  });

  it("unsubscribe: promotions_unsubscribe for the member, and no direct write", async () => {
    scenario.rpc.promotions_unsubscribe = { marketing_consent: true, email_promotions: true };
    expect(await post("unsubscribe")).toEqual({ ok: true, status: "unsubscribed" });
    expect(calls("promotions_unsubscribe").map((c) => c.args)).toEqual([{ p_user_id: MEMBER }]);
    expect(consentWrites()).toEqual([]);
  });

  it("unsubscribe whose RPC fails (or is not deployed): both flags still go off directly, with no record", async () => {
    scenario.rpcErrors = { promotions_unsubscribe: { message: "Could not find the function", code: "PGRST202" } };
    expect((await post("unsubscribe")).ok).toBe(true);
    expect(consentWrites().map((w) => [w.table, w.payload])).toEqual([
      ["profiles", { marketing_consent: false }],
      ["notification_preferences", { user_id: MEMBER, email_promotions: false }],
    ]);
  });

  it("resubscribe: promotions_resubscribe for the member decides and writes; the function writes nothing itself", async () => {
    scenario.rpc.promotions_resubscribe = "restored";
    expect(await post("resubscribe")).toEqual({ ok: true, status: "resubscribed" });
    expect(calls("promotions_resubscribe").map((c) => c.args)).toEqual([{ p_user_id: MEMBER }]);
    expect(consentWrites()).toEqual([]);
  });

  it("resubscribe whose RPC fails: the request fails and nothing is written", async () => {
    scenario.rpcErrors = { promotions_resubscribe: { message: "boom", code: "XX000" } };
    expect(await post("resubscribe")).toEqual({ ok: false, reason: "failed" });
    expect(consentWrites()).toEqual([]);
  });
});

describe("the newest definitions keep each rule", () => {
  const dir = join(process.cwd(), "supabase/migrations");
  const defs = effectiveDefs(dir);
  const flat = (name: string) => blankSqlComments(defs.get(name)?.stmt ?? "").replace(/\s+/g, " ");
  /** The newest migration that (re)creates a trigger, comment-blanked and flattened. */
  const trigger = (name: string) => {
    const files = migrationFiles(dir).filter((f) =>
      blankSqlComments(readFileSync(join(dir, f), "utf8")).includes(`CREATE TRIGGER ${name}`));
    const sql = blankSqlComments(readFileSync(join(dir, files[files.length - 1] ?? ""), "utf8")).replace(/\s+/g, " ");
    const at = sql.lastIndexOf(`CREATE TRIGGER ${name}`);
    return sql.slice(at, sql.indexOf(";", at));
  };

  it("reads the newest definitions (floor)", () => {
    expect(defs.size).toBeGreaterThan(100);
  });

  it("the newest profiles_locked_update_columns() locks the record, so the grant sync never gives clients UPDATE on it", () => {
    expect(flat("profiles_locked_update_columns")).toMatch(/'promotions_before_unsubscribe'/);
  });

  it("a consent change that is not the link's own write clears the record", () => {
    expect(trigger("trg_clear_promotions_undo_on_consent_change")).toMatch(/BEFORE UPDATE OF marketing_consent ON public\.profiles FOR EACH ROW/);
    const body = flat("clear_promotions_undo_on_consent_change");
    expect(body).toMatch(/IF NEW\.marketing_consent IS DISTINCT FROM OLD\.marketing_consent AND current_setting\('app\.promotions_undo_write', true\) IS DISTINCT FROM '1' THEN NEW\.promotions_before_unsubscribe := NULL;/);
  });

  it("a Promotions change that is not the link's own write clears the record (SECURITY DEFINER: the column is locked)", () => {
    expect(trigger("trg_clear_promotions_undo_on_promotions_change")).toMatch(/AFTER INSERT OR UPDATE OF email_promotions ON public\.notification_preferences FOR EACH ROW/);
    const body = flat("clear_promotions_undo_on_promotions_change");
    expect(body).toMatch(/SECURITY DEFINER/);
    expect(body).toMatch(/TG_OP = 'INSERT' OR NEW\.email_promotions IS DISTINCT FROM OLD\.email_promotions/);
    expect(body).toMatch(/UPDATE public\.profiles SET promotions_before_unsubscribe = NULL WHERE user_id = NEW\.user_id/);
  });

  it("the opt-out locks both rows, keeps the first record only while nothing is on, and marks its own writes", () => {
    const body = flat("promotions_unsubscribe");
    expect(body).toMatch(/WHERE p\.user_id = p_user_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found'/);
    expect(body).toMatch(/WHERE np\.user_id = p_user_id FOR UPDATE; v_has_row := FOUND; IF NOT v_has_row THEN v_promo := true;/);
    expect(body).toMatch(/jsonb_build_object\('marketing_consent', v_consent IS TRUE, 'email_promotions', to_jsonb\(v_promo\)\)/);
    expect(body).toMatch(/IF v_saved IS NOT NULL AND NOT \(v_consent IS TRUE OR v_promo IS TRUE\) THEN v_record := v_saved;/);
    expect(body).toMatch(/PERFORM set_config\('app\.promotions_undo_write', '1', true\); UPDATE public\.profiles SET marketing_consent = false, promotions_before_unsubscribe = v_record/);
  });

  it("the undo writes nothing without a record and restores exactly, only while both flags are still off", () => {
    const body = flat("promotions_resubscribe");
    expect(body).toMatch(/IF v_saved IS NULL THEN RETURN 'nothing_to_undo';/);
    expect(body).toMatch(/v_untouched := FOUND AND v_consent IS FALSE AND v_promo IS FALSE;/);
    expect(body).toMatch(/SET marketing_consent = \(v_saved ->> 'marketing_consent'\)::boolean IS TRUE, promotions_before_unsubscribe = NULL/);
    expect(body).toMatch(/IF \(v_saved ->> 'email_promotions'\)::boolean IS DISTINCT FROM false THEN UPDATE public\.notification_preferences SET email_promotions = CASE WHEN \(v_saved ->> 'email_promotions'\)::boolean THEN true END/);
  });

  it("a member's own profile INSERT may not carry a record (Q2160): the newest INSERT policy pins it to NULL", () => {
    const name = 'CREATE POLICY "Users can insert their own profile"';
    const files = migrationFiles(dir).filter((f) => blankSqlComments(readFileSync(join(dir, f), "utf8")).includes(name));
    expect(files.length).toBeGreaterThan(1);
    const sql = blankSqlComments(readFileSync(join(dir, files[files.length - 1] ?? ""), "utf8")).replace(/\s+/g, " ");
    const at = sql.lastIndexOf(name);
    const policy = sql.slice(at, sql.indexOf(";", at));
    expect(policy).toMatch(/FOR INSERT TO authenticated WITH CHECK \(/);
    // Every predicate is AND-ed: an OR anywhere would let a record through.
    expect(policy).toMatch(/ AND is_seed = false AND promotions_before_unsubscribe IS NULL \)$/);
    expect(/\bOR\b(?! ban_status = 'active')/.test(policy), "only the ban_status pin may use OR").toBe(false);
  });

  it("both RPCs are server-only", () => {
    const all = migrationFiles(dir).map((f) => blankSqlComments(readFileSync(join(dir, f), "utf8"))).join("\n").replace(/\s+/g, " ");
    for (const fn of ["promotions_unsubscribe", "promotions_resubscribe"]) {
      // Booleans, not toContain: a failure must not print every migration.
      // Read from the NEWEST migration that grants or revokes it (Q2390 packet 22 restated both): an older copy of the
      // REVOKE must not satisfy this once a later file restates the grants.
      const aclRe = new RegExp(`\\b(?:GRANT|REVOKE)\\b[^;]* ON FUNCTION public\\.${fn}\\(uuid\\)`);
      const aclFiles = migrationFiles(dir).filter((f) => aclRe.test(blankSqlComments(readFileSync(join(dir, f), "utf8"))));
      const newestAcl = blankSqlComments(readFileSync(join(dir, aclFiles[aclFiles.length - 1] ?? ""), "utf8")).replace(/\s+/g, " ");
      expect(newestAcl.includes(`REVOKE ALL ON FUNCTION public.${fn}(uuid) FROM PUBLIC, anon, authenticated;`), `${fn} revoked from anon and authenticated (newest: ${aclFiles[aclFiles.length - 1]})`).toBe(true);
      expect(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\(uuid\\) TO [^;]*\\b(anon|authenticated)\\b`).test(all), `${fn} granted to a client role`).toBe(false);
    }
  });
});
