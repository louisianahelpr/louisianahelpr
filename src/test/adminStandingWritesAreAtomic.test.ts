/**
 * Q1494 / Q1496 (docs/OPEN.md; lh-money-escrow reviews of Q1414 and Q1413).
 *
 * Q1494, THE CLASS: an admin action that changes an account's standing wrote
 * its rows as SEPARATE requests (BanDialog: user_bans, user_violations, then
 * profiles.ban_status; the message-ban review's Confirm: user_bans then the
 * status; formal_warning: the strike then the status). A ban settlement review
 * opened in between was refused only at the status write, so a ban row and a
 * strike stayed behind. Now every one goes through ONE transaction,
 * admin_apply_account_action (migration
 * 20261012185742_ban_actions_atomic_and_remaining_strikes.sql).
 *
 * Inventory, from source: every tracked .ts/.tsx under src/ (tests excluded)
 * and supabase/functions. No code there may INSERT/UPSERT user_bans or
 * user_violations directly; the list of such writes is exact (empty), so a new
 * one fails here until it goes through the transactional RPC.
 *
 * Q1496: the lift and the confirm apply the harshest deferred rung the strikes
 * that REMAIN still reach (ban_review_standing_rung), not the harshest standing
 * ever deferred.
 *
 * Behaviour: src/test/pglite/banActionsAtomic.pglite.mjs (prod's code by md5;
 * NEW_MIGRATION=skip: the Q1496 cases FAIL and the old three-request flow is
 * shown leaving its rows; with the migration applied 3x: ALL PASS).
 *
 * @mutate supabase/functions/admin-user-actions/index.ts |       const { error: applyErr } = await admin.rpc('admin_apply_account_action', {\n        p_user_id: targetUserId,\n        p_admin_id: userData.user.id,\n        p_action: actionTaken | await admin.from('user_violations').insert({ user_id: targetUserId, violation_type: 'admin_warning', action_taken: actionTaken })\n      const { error: applyErr } = await admin.rpc('admin_apply_account_action', {\n        p_user_id: targetUserId,\n        p_admin_id: userData.user.id,\n        p_action: actionTaken
 * @mutate supabase/migrations/20261012185742_ban_actions_atomic_and_remaining_strikes.sql |     -- The strike's ladder trigger turned this on for the rest of the transaction.\n    PERFORM set_config('app.trusted_ladder_write', 'off', true); |     NULL;
 * @mutate supabase/migrations/20261013001155_ban_review_confirm_keeps_strictest_retained_judgment.sql |   v_rung := public.ban_review_standing_rung(v_review.id, true); |   v_rung := NULL;
 * @mutate supabase/migrations/20261012185742_ban_actions_atomic_and_remaining_strikes.sql |                                              WHERE v.id = b.id::uuid)) | WHERE true))
 * @mutate supabase/migrations/20261012185742_ban_actions_atomic_and_remaining_strikes.sql |                                   v.violation_type = n.violation_type |                                   true
 * @mutate supabase/migrations/20261012185742_ban_actions_atomic_and_remaining_strikes.sql |     v_lift := public.lift_ban_settlement_review(p_user_id, p_admin_id, v_status); |     v_lift := NULL;
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { trackedFiles } from "./helpers/trackedFiles";

const ROOT = process.cwd();
const sources = [...trackedFiles("src"), ...trackedFiles("supabase/functions")]
  .filter((f) => /^(src|supabase\/functions)\/.+\.(ts|tsx)$/.test(f))
  .filter((f) => !/\/test\/|\.test\.|\.spec\.|integrations\/supabase\/types/.test(f));

/** `<file>: <table>.<insert|upsert>` for every direct write of the two strike tables. */
function directStrikeWrites(): string[] {
  const out: string[] = [];
  for (const f of sources) {
    const code = blankComments(readFileSync(join(ROOT, f), "utf8"));
    for (const m of code.matchAll(/\.from\(\s*["'`](user_bans|user_violations)["'`]\s*\)/g)) {
      // The chain this .from() starts: up to the statement's end or the next .from(.
      const rest = code.slice(m.index! + m[0].length);
      const stop = [rest.indexOf(";"), rest.search(/\.from\(/)].filter((i) => i >= 0);
      const chain = rest.slice(0, stop.length ? Math.min(...stop) : rest.length);
      const w = /^\s*\.(insert|upsert)\s*\(/.exec(chain);
      if (w) out.push(`${f}: ${m[1]}.${w[1]}`);
    }
  }
  return out.sort();
}

describe("Q1494: an admin standing change is one transaction", () => {
  it("scans a real inventory (floor)", () => {
    expect(sources.length).toBeGreaterThan(500);
    const reads = sources.filter((f) => /\.from\(\s*["'`]user_violations["'`]\s*\)/.test(readFileSync(join(ROOT, f), "utf8")));
    expect(reads.length, "files that touch user_violations").toBeGreaterThan(3);
  });

  it("nothing in src/ or supabase/functions inserts a ban row or a strike directly (exact: none)", () => {
    expect(directStrikeWrites()).toEqual([]);
  });

  it("the detector is not vacuous", () => {
    const probe = 'await admin.from("user_violations").insert({ user_id: x });\nawait supabase.from("user_bans").select("id");';
    const hits = [...probe.matchAll(/\.from\(\s*["'`](user_bans|user_violations)["'`]\s*\)\s*\.(insert|upsert)\s*\(/g)].map((m) => m[1]);
    expect(hits).toEqual(["user_violations"]);
  });

  it("admin-user-actions routes all three standing changes through admin_apply_account_action", () => {
    const src = blankComments(readFileSync(join(ROOT, "supabase/functions/admin-user-actions/index.ts"), "utf8"));
    expect((src.match(/admin\.rpc\(\s*'admin_apply_account_action'/g) ?? []).length).toBe(3);
    for (const branch of ["apply_account_action", "formal_warning", "confirm_message_ban"]) {
      const at = src.indexOf(`action === '${branch}'`);
      expect(at, branch).toBeGreaterThan(-1);
      expect(src.slice(at).search(/admin\.rpc\(\s*'admin_apply_account_action'/), branch).toBeGreaterThan(-1);
    }
  });

  const defs = effectiveDefs(join(ROOT, "supabase/migrations"));
  const body = (n: string) => blankSqlComments(defs.get(n)?.stmt ?? "");

  it("admin_apply_account_action locks the profile, refuses an open review, writes the ban row before the standing, and ends the ladder flag", () => {
    const b = body("admin_apply_account_action");
    expect(b).toMatch(/SECURITY DEFINER/);
    const lock = b.search(/FROM public\.profiles p WHERE p\.user_id = p_user_id FOR UPDATE/);
    const review = b.search(/RAISE EXCEPTION 'ban_review_open'/);
    const status = b.search(/UPDATE public\.profiles\s+SET ban_status = v_status/);
    const ban = b.search(/INSERT INTO public\.user_bans/);
    const strike = b.search(/INSERT INTO public\.user_violations/);
    expect(lock, "the profile row lock is what keeps a review opener out between the check and the writes").toBeGreaterThan(-1);
    expect(review).toBeGreaterThan(lock);
    // The ban row first: the profile update's trg_retain_ban_on_ban reads it.
    expect(ban).toBeGreaterThan(review);
    expect(status).toBeGreaterThan(ban);
    expect(strike).toBeGreaterThan(status);
    // A warning out of a ban ends a confirmed review, as set_ban_status did.
    expect(b.search(/public\.lift_ban_settlement_review\(p_user_id, p_admin_id, v_status\)/)).toBeGreaterThan(review);
    expect(b.slice(strike)).toMatch(/set_config\('app\.trusted_ladder_write', 'off', true\)/);
    const mig = readFileSync(join(ROOT, "supabase/migrations", defs.get("admin_apply_account_action")!.file), "utf8");
    expect(mig).toMatch(/REVOKE ALL ON FUNCTION public\.admin_apply_account_action\([^)]*\) FROM PUBLIC, anon, authenticated/);
  });
});

describe("Q1496: a lift or a confirm applies only a rung whose strikes all still stand", () => {
  const defs = effectiveDefs(join(ROOT, "supabase/migrations"));
  const body = (n: string) => blankSqlComments(defs.get(n)?.stmt ?? "");

  it("every deferral is kept with its basis (the strikes on record when it was set)", () => {
    const refuse = body("refuse_unban_during_ban_review");
    expect(refuse).toMatch(/deferred_rungs = r\.deferred_rungs \|\| jsonb_build_array\(jsonb_build_object\([\s\S]*'basis', \(WITH n AS/);
    // The ladder's own count: auto_restrict's types over 7 days, every other
    // ladder its own type for life (lh-money-escrow re-review).
    expect(refuse).toMatch(/WHEN n\.violation_type IN \('cancel_with_helper', 'off_platform', 'no_show'\) THEN\s+v\.violation_type = n\.violation_type/);
    expect(refuse).toMatch(/AND v\.created_at >= now\(\) - interval '7 days'/);
    expect(refuse).not.toMatch(/interval '90 days'/);
  });

  it("a rung stands only while every strike in its basis still stands", () => {
    expect(body("ban_review_standing_rung")).toMatch(/NOT EXISTS \(SELECT 1 FROM jsonb_array_elements_text\(x\.rung -> 'basis'\) AS b\(id\)\s+WHERE NOT EXISTS \(SELECT 1 FROM public\.user_violations v\s+WHERE v\.id = b\.id::uuid\)\)/);
  });

  it("the lift and the confirm decide from that rung, never the stored maximum", () => {
    for (const fn of ["lift_ban_settlement_review", "admin_confirm_ban_settlement"]) {
      const b = body(fn);
      expect(b, fn).toMatch(/v_rung := public\.ban_review_standing_rung\(v_review\.id, (true|false)\)/);
      expect(b, fn).not.toMatch(/public\.ban_standing_rank\(v_review\.deferred_ban_status\)/);
    }
  });
});
