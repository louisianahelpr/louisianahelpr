/**
 * Q1586 + Q1495 CLASS GUARD (owner 2026-10-12: a phone written after sign-up
 * that is a banned account's EXACT number bans at once, like sign-up).
 *
 * The class: an exact retained-ban key that a member can write to their own
 * profile after sign-up must reach enforce_retained_ban, through a path that
 * can actually write ban_status from the member's own write. Sign-up checks
 * the phone with the service role (complete-signup); since 2026-10-09 the
 * phone arrives later, through the member's own profiles UPDATE, where
 * tr_prevent_self_escalation pins ban_status back unless the transaction-local
 * app.trusted_ladder_write is 'on'. Before 20261012042748 nothing on that
 * path called enforce_retained_ban (only flag_possible_ban_evasion_by_phone,
 * an admin doubt-check), so this test was RED.
 *
 * Read from the migrations (comments blanked, any dollar-quote tag, the
 * definition the migrations actually leave: effectiveDefs / triggerInventory).
 *
 *   1. INVENTORY: the exact keys enforce_retained_ban bans on that live in a
 *      profiles column a member writes (today: phone). Each has a standing
 *      AFTER INSERT OR UPDATE OF <column> trigger on profiles whose function
 *      calls enforce_retained_ban for NEW.user_id (the written row only) with
 *      that column.
 *   2. That function can make the ban stick: SECURITY DEFINER, pinned
 *      search_path, sets app.trusted_ladder_write 'on' before the call and
 *      restores the previous value after it; prevent_self_escalation still
 *      honours that setting.
 *   3. Test accounts are exempt (56 share a fixture number on prod), and the
 *      trigger fires AFTER the doubt-check flag (name order), so the flag's
 *      exact row can be marked enforced.
 *   4. Nobody can call the trigger function (REVOKE ... FROM PUBLIC, anon,
 *      authenticated in the migration that leaves its definition).
 *   5. Q1497: when enforce_retained_ban bans, its match record takes over a
 *      doubt-check already filed for the same match (ON CONFLICT ... DO UPDATE
 *      SET auto_banned = true), so a banned account leaves the admin
 *      doubt-check list (AdminBanEvasionReview lists auto_banned = false).
 *      PGlite case 10; NEW_MIGRATION=skip-1497 is RED (1 FAIL).
 *
 * Behaviour (real enforce_retained_ban + prevent_self_escalation + the rest
 * of the chain, authenticated member, applied 3x):
 *   npx tsx src/test/pglite/phoneChangeRetainedBan.pglite.mjs   (21 PASS)
 *   NEW_MIGRATION=skip npx tsx src/test/pglite/phoneChangeRetainedBan.pglite.mjs   (8 FAIL)
 *
 * @mutate supabase/migrations/20261012042748_phone_change_retained_ban.sql |     v_result := public.enforce_retained_ban(NEW.user_id, NULL, NEW.phone, NULL); |     v_result := jsonb_build_object('banned', false);
 * @mutate supabase/migrations/20261012042748_phone_change_retained_ban.sql |   PERFORM set_config('app.trusted_ladder_write', 'on', true); |   PERFORM 1;
 * @mutate supabase/migrations/20261012042748_phone_change_retained_ban.sql |   PERFORM set_config('app.trusted_ladder_write', COALESCE(v_prev, ''), true); |   PERFORM 1;
 * @mutate supabase/migrations/20261012042748_phone_change_retained_ban.sql |   AFTER INSERT OR UPDATE OF phone ON public.profiles\n  FOR EACH ROW EXECUTE FUNCTION public.enforce_retained_ban_on_phone(); |   AFTER INSERT ON public.profiles\n  FOR EACH ROW EXECUTE FUNCTION public.enforce_retained_ban_on_phone();
 * @mutate supabase/migrations/20261012042748_phone_change_retained_ban.sql | CREATE TRIGGER trg_retained_ban_on_phone_change | CREATE TRIGGER trg_a_retained_ban_on_phone_change
 * @mutate supabase/migrations/20261012042748_phone_change_retained_ban.sql | REVOKE ALL ON FUNCTION public.enforce_retained_ban_on_phone() FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.enforce_retained_ban_on_phone() FROM PUBLIC;
 * @mutate supabase/migrations/20261012042748_phone_change_retained_ban.sql |   IF COALESCE(NEW.is_seed, false) THEN | IF false THEN
 * @mutate supabase/migrations/20261012042748_phone_change_retained_ban.sql | SECURITY DEFINER\nSET search_path TO 'public', 'pg_temp'\nAS $fn$\nDECLARE\n  v_full | SET search_path TO 'public', 'pg_temp'\nAS $fn$\nDECLARE\n  v_full
 * @mutate supabase/migrations/20261012065930_retained_ban_marks_doubt_row.sql |         DO UPDATE SET auto_banned = true\n        WHERE NOT public.ban_evasion_matches.auto_banned; |         DO NOTHING;
 * @mutate supabase/migrations/20261012065930_retained_ban_marks_doubt_row.sql | UPDATE public.ban_evasion_matches m\n   SET auto_banned = true | UPDATE public.ban_evasion_matches m\n   SET auto_banned = m.auto_banned
 * @mutate supabase/migrations/20260923172405_retire_approval_status_reads.sql |   IF current_setting('app.trusted_ladder_write', true) = 'on' THEN\n    RETURN NEW; |   IF false THEN\n    RETURN NEW;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { bodyOf, triggerInventory, type Trg } from "./helpers/migrationTriggers";

const ROOT = process.cwd();
const MIG = join(ROOT, "supabase", "migrations");
const files = migrationFiles(MIG);
const sqlOf = (f: string) => readFileSync(join(MIG, f), "utf8");
const defs = effectiveDefs(MIG);
const stmt = (fn: string) => {
  const d = defs.get(fn);
  if (!d) throw new Error(`no migration leaves public.${fn}`);
  return d;
};
const code = (fn: string) => blankSqlComments(bodyOf(stmt(fn).stmt));
const triggers = triggerInventory(files.map((name) => ({ name, sql: sqlOf(name) })));

/** The parameters enforce_retained_ban hashes into an EXACT ban key, mapped to the profiles column a member writes. */
const MEMBER_WRITTEN_KEY_COLUMN: Record<string, string | null> = {
  p_email: null, // auth.users owns email; a change goes through Supabase Auth, not a profiles write
  p_phone: "phone",
  p_identity_sha256: null, // written only by stripe-idv-webhook (service role), which calls enforce_retained_ban itself
};

function enforcerParams(): string[] {
  const head = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?enforce_retained_ban\s*\(([\s\S]*?)\)\s*returns/i.exec(
    blankSqlComments(stmt("enforce_retained_ban").stmt),
  );
  if (!head) throw new Error("enforce_retained_ban has no parseable signature");
  return [...head[1].matchAll(/(?:^|,)\s*(p_\w+)\s/g)].map((m) => m[1].toLowerCase()).filter((p) => p !== "p_user_id");
}

/** Standing AFTER triggers on profiles that fire on a write of `col` (INSERT and UPDATE OF col). */
function profileTriggersOn(col: string): Trg[] {
  return [...triggers.values()].filter(
    (t) =>
      t.table === "profiles" &&
      t.timing === "AFTER" &&
      /\bINSERT\b/.test(t.events) &&
      new RegExp(`\\bUPDATE\\s+OF\\b[\\s\\S]*\\b${col}\\b`, "i").test(t.events),
  );
}

describe("Q1586/Q1495: a retained-ban phone written after sign-up bans at once", () => {
  it("inventory: every exact key enforce_retained_ban bans on is classified (no new key goes unchecked)", () => {
    const params = enforcerParams();
    // Floor (2026-10-12): email, phone, identity.
    expect(params.length).toBeGreaterThan(2);
    for (const p of params) expect(Object.keys(MEMBER_WRITTEN_KEY_COLUMN), `unclassified ban key ${p}`).toContain(p);
    const cols = params.map((p) => MEMBER_WRITTEN_KEY_COLUMN[p]).filter((c): c is string => !!c);
    expect(cols).toEqual(["phone"]);
  });

  for (const [param, col] of Object.entries(MEMBER_WRITTEN_KEY_COLUMN)) {
    if (!col) continue;
    it(`a member's write of profiles.${col} reaches enforce_retained_ban for that row, with the ban able to stick`, () => {
      const enforcing = profileTriggersOn(col).filter((t) => /\bpublic\.enforce_retained_ban\s*\(/i.test(code(t.fn)));
      expect(enforcing.map((t) => t.name), `no AFTER INSERT OR UPDATE OF ${col} trigger on profiles calls enforce_retained_ban`).toHaveLength(1);
      const t = enforcing[0];
      const body = code(t.fn);
      const full = blankSqlComments(stmt(t.fn).stmt);

      // Only the written row: user id is NEW.user_id, and the key is NEW.<col> in the slot of `param`.
      const call = /public\.enforce_retained_ban\s*\(([^;]*?)\)\s*;/i.exec(body);
      expect(call, "enforce_retained_ban call").not.toBeNull();
      const args = call![1].split(",").map((a) => a.trim());
      const slot = ["p_user_id", ...enforcerParams()].indexOf(param);
      expect(args[0]).toMatch(/^NEW\.user_id$/i);
      expect(args[slot]).toMatch(new RegExp(`^NEW\\.${col}$`, "i"));

      // Can write ban_status from a member's own write, and only for this call.
      expect(full).toMatch(/\bSECURITY\s+DEFINER\b/i);
      expect(full).toMatch(/\bSET\s+search_path\s+(?:TO|=)\s+'public'\s*,\s*'pg_temp'/i);
      const on = body.search(/set_config\(\s*'app\.trusted_ladder_write'\s*,\s*'on'\s*,\s*true\s*\)/i);
      const callAt = body.search(/public\.enforce_retained_ban\s*\(/i);
      const restore = body.search(/set_config\(\s*'app\.trusted_ladder_write'\s*,\s*COALESCE\(\s*v_prev\s*,\s*''\s*\)\s*,\s*true\s*\)/i);
      const saved = body.search(/v_prev\s*:=\s*current_setting\(\s*'app\.trusted_ladder_write'\s*,\s*true\s*\)/i);
      expect(saved, "the previous app.trusted_ladder_write is saved").toBeGreaterThan(-1);
      expect(on, "app.trusted_ladder_write is set 'on' before the call").toBeGreaterThan(saved);
      expect(callAt).toBeGreaterThan(on);
      expect(restore, "app.trusted_ladder_write is restored after the call").toBeGreaterThan(callAt);

      // Test accounts are exempt; the trigger fires after the doubt-check flag.
      expect(body).toMatch(/IF\s+COALESCE\(\s*NEW\.is_seed\s*,\s*false\s*\)\s+THEN\s+RETURN\s+NULL/i);
      const flag = profileTriggersOn(col).find((x) => x.fn === "flag_possible_ban_evasion_by_phone");
      expect(flag, "the doubt-check flag trigger is still standing").toBeDefined();
      expect(t.name > flag!.name, `${t.name} must sort after ${flag!.name}`).toBe(true);

      // Nobody's to call: revoked in the migration that leaves the definition.
      const src = blankSqlComments(sqlOf(stmt(t.fn).file));
      expect(src).toMatch(new RegExp(`REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.${t.fn}\\(\\)\\s+FROM\\s+PUBLIC\\s*,\\s*anon\\s*,\\s*authenticated\\s*;`, "i"));
    });
  }

  it("prevent_self_escalation still lets the trusted-ladder write through (and pins ban_status otherwise)", () => {
    const body = code("prevent_self_escalation");
    const trusted = body.search(/IF\s+current_setting\(\s*'app\.trusted_ladder_write'\s*,\s*true\s*\)\s*=\s*'on'\s+THEN\s+RETURN\s+NEW/i);
    const pin = body.search(/NEW\.ban_status\s*:=\s*OLD\.ban_status/i);
    expect(trusted).toBeGreaterThan(-1);
    expect(pin).toBeGreaterThan(trusted);
  });

  it("Q1497: the ban's match record marks a doubt-check already filed for the same match (auto_banned)", () => {
    const body = code("enforce_retained_ban");
    const insert = /INSERT\s+INTO\s+public\.ban_evasion_matches[\s\S]*?;/i.exec(body);
    expect(insert, "enforce_retained_ban no longer records its match in ban_evasion_matches").not.toBeNull();
    expect(insert![0]).toMatch(/ON\s+CONFLICT\s*\(\s*user_id\s*,\s*matched_on\s*,\s*retained_ban_id\s*\)\s*DO\s+UPDATE\s+SET\s+auto_banned\s*=\s*true/i);
    const src = blankSqlComments(sqlOf(stmt("enforce_retained_ban").file));
    // The rows already stuck at false on prod: the function never runs again
    // for an account that is already banned, so the same migration backfills them.
    expect(src).toMatch(/UPDATE\s+public\.ban_evasion_matches\s+m\s+SET\s+auto_banned\s*=\s*true[\s\S]*?NOT\s+m\.auto_banned[\s\S]*?ban_status\s+IN/i);
    expect(src).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.enforce_retained_ban\(uuid,\s*text,\s*text,\s*text\)\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated\s*;/i);
  });
});
