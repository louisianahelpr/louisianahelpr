/**
 * Q1714 CLASS GUARD (owner decision 2026-10-15, "JUST FLAG IT"): a phone that
 * matches a banned account flags the account for an admin's second look; it
 * NEVER bans, and no SMS check is built. Supersedes Q1586/Q1495 (2026-10-12),
 * which banned at once on an exact phone and is what this file pinned before.
 *
 * Why: a phone is typed and never confirmed, so a banned member who saved
 * someone else's real number could get that person banned the moment they
 * added it (lh-authz-rls@d1438994d#1).
 *
 * The class: a retained-ban key a member can type unverified (a profiles
 * column the member writes: today phone) is never a BAN key. Read from the
 * migrations (comments blanked, any dollar-quote tag, the definition the
 * migrations actually leave: effectiveDefs / triggerInventory).
 *
 *   1. INVENTORY: every parameter enforce_retained_ban hashes is classified as
 *      member-written (unverified) or not; the ban match (its first
 *      retained_bans read, the one that decides v_row before the ban) reads no
 *      member-written key.
 *   2. No standing trigger on profiles calls enforce_retained_ban (the
 *      phone-change auto-ban of 20261012042748 is dropped).
 *   3. An exact phone still reaches the admin: enforce_retained_ban files a
 *      doubt-check (ban_evasion_matches, auto_banned false) and answers
 *      banned=false; flag_possible_ban_evasion_by_phone files the exact
 *      number on INSERT as well as UPDATE.
 *   4. Q1497 kept: a ban on the email or identity marks a doubt-check already
 *      filed for the same match (ON CONFLICT ... DO UPDATE SET auto_banned).
 *
 * Behaviour (real enforce_retained_ban + the profiles trigger chain, applied 3x):
 *   npx tsx src/test/pglite/phoneMatchFlagsNotBans.pglite.mjs                      (ALL PASS)
 *   NEW_MIGRATION=skip npx tsx src/test/pglite/phoneMatchFlagsNotBans.pglite.mjs   (12 FAIL)
 *
 * @mutate supabase/migrations/20261015051417_phone_match_flags_not_bans.sql |    WHERE (v_email_h IS NOT NULL AND email_sha256    = v_email_h)\n      OR (v_ident_h IS NOT NULL AND identity_sha256 = v_ident_h)\n   ORDER BY |    WHERE (v_email_h IS NOT NULL AND email_sha256    = v_email_h)\n      OR (v_phone_h IS NOT NULL AND phone_sha256    = v_phone_h)\n      OR (v_ident_h IS NOT NULL AND identity_sha256 = v_ident_h)\n   ORDER BY
 * @mutate supabase/migrations/20261015051417_phone_match_flags_not_bans.sql | DROP TRIGGER IF EXISTS trg_retained_ban_on_phone_change ON public.profiles; | SELECT 1;
 * @mutate supabase/migrations/20261015051417_phone_match_flags_not_bans.sql |                   v_row.retained_at, v_row.expires_at, false)\n          ON CONFLICT (user_id, matched_on, retained_ban_id) DO NOTHING; |                   v_row.retained_at, v_row.expires_at, true)\n          ON CONFLICT (user_id, matched_on, retained_ban_id) DO NOTHING;
 * @mutate supabase/migrations/20261015051417_phone_match_flags_not_bans.sql |      WHERE (phone7_sha256 = v_h7 OR phone_sha256 = v_full) |      WHERE (phone7_sha256 = v_h7 OR (TG_OP = 'UPDATE' AND phone_sha256 = v_full))
 * @mutate supabase/migrations/20261015051417_phone_match_flags_not_bans.sql |         DO UPDATE SET auto_banned = true\n        WHERE NOT public.ban_evasion_matches.auto_banned; |         DO NOTHING;
 * @mutate supabase/migrations/20261015051417_phone_match_flags_not_bans.sql |   IF COALESCE(NEW.is_seed, false) THEN | IF false THEN
 * @mutate supabase/migrations/20261015051417_phone_match_flags_not_bans.sql |     v_retired := true; |     RETURN jsonb_build_object('banned', false, 'matched_on', NULL, 'retired', true);
 * @mutate supabase/migrations/20261015051417_phone_match_flags_not_bans.sql |    SET resolved = true |    SET resolved = m.resolved
 * @mutate supabase/migrations/20261012065930_retained_ban_marks_doubt_row.sql | UPDATE public.ban_evasion_matches m\n   SET auto_banned = true | UPDATE public.ban_evasion_matches m\n   SET auto_banned = m.auto_banned
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { bodyOf, triggerInventory } from "./helpers/migrationTriggers";

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

/** The parameters enforce_retained_ban hashes, mapped to the profiles column a member writes unverified (null: not member-written). */
const MEMBER_WRITTEN_KEY_COLUMN: Record<string, string | null> = {
  p_email: null, // auth.users owns email, confirmed by Supabase Auth; a change goes through Auth, not a profiles write
  p_phone: "phone", // typed, never SMS-verified
  p_identity_sha256: null, // written only by stripe-idv-webhook (service role) from a verified Stripe Identity
};
/** The variable each parameter is hashed into inside enforce_retained_ban. */
const HASH_VAR: Record<string, string> = { p_email: "v_email_h", p_phone: "v_phone_h", p_identity_sha256: "v_ident_h" };
const KEY_COLUMN: Record<string, string> = { p_email: "email_sha256", p_phone: "phone_sha256", p_identity_sha256: "identity_sha256" };

function enforcerParams(): string[] {
  const head = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?enforce_retained_ban\s*\(([\s\S]*?)\)\s*returns/i.exec(
    blankSqlComments(stmt("enforce_retained_ban").stmt),
  );
  if (!head) throw new Error("enforce_retained_ban has no parseable signature");
  return [...head[1].matchAll(/(?:^|,)\s*(p_\w+)\s/g)].map((m) => m[1].toLowerCase()).filter((p) => p !== "p_user_id");
}

/** The retained_bans read that decides the ban: the first one, up to its LIMIT. */
function banMatch(): string {
  const m = /SELECT\s+\*\s+INTO\s+v_row\s+FROM\s+public\.retained_bans\s+WHERE([\s\S]*?)LIMIT\s+1\s*;/i.exec(code("enforce_retained_ban"));
  if (!m) throw new Error("enforce_retained_ban has no retained_bans ban match");
  return m[1];
}

describe("Q1714: a phone matching a banned account flags it for an admin, never bans", () => {
  it("inventory: every key enforce_retained_ban hashes is classified (floor: email, phone, identity)", () => {
    const params = enforcerParams();
    expect(params.length).toBeGreaterThan(2);
    for (const p of params) expect(Object.keys(MEMBER_WRITTEN_KEY_COLUMN), `unclassified ban key ${p}`).toContain(p);
    expect(params.filter((p) => MEMBER_WRITTEN_KEY_COLUMN[p])).toEqual(["p_phone"]);
  });

  it("the ban match reads no member-written (unverified) key, and still reads every verified one", () => {
    const match = banMatch();
    for (const p of enforcerParams()) {
      const reads = new RegExp(`\\b${HASH_VAR[p]}\\b`).test(match) || new RegExp(`\\b${KEY_COLUMN[p]}\\b`).test(match);
      if (MEMBER_WRITTEN_KEY_COLUMN[p]) expect(reads, `${p} is typed unverified and must not decide a ban`).toBe(false);
      else expect(reads, `${p} stopped deciding a ban`).toBe(true);
    }
  });

  it("no standing trigger on profiles calls enforce_retained_ban (the phone-change auto-ban is gone)", () => {
    const onProfiles = [...triggers.values()].filter((t) => t.table === "profiles");
    expect(onProfiles.length, "floor: profiles triggers found").toBeGreaterThan(5);
    const calling = onProfiles.filter((t) => defs.has(t.fn) && /\bpublic\.enforce_retained_ban\s*\(/i.test(code(t.fn)));
    expect(calling.map((t) => t.name)).toEqual([]);
    expect(defs.has("enforce_retained_ban_on_phone"), "enforce_retained_ban_on_phone is dropped").toBe(false);
    // A standing trigger needs its function: dropping the function and not its
    // trigger fails the deploy (Postgres refuses DROP FUNCTION while a trigger uses it).
    expect(onProfiles.filter((t) => !defs.has(t.fn)).map((t) => `${t.name} -> ${t.fn}`)).toEqual([]);
  });

  it("an exact phone still reaches the admin: enforce_retained_ban files a doubt-check and answers banned=false", () => {
    const body = code("enforce_retained_ban");
    const matchAt = body.indexOf(banMatch());
    const flag = /INSERT\s+INTO\s+public\.ban_evasion_matches[\s\S]*?VALUES\s*\(\s*p_user_id\s*,\s*'phone'\s*,\s*v_phone_h[\s\S]*?,\s*false\s*\)\s*ON\s+CONFLICT[\s\S]*?DO\s+NOTHING\s*;/i.exec(body);
    expect(flag, "the phone doubt-check insert (auto_banned false)").not.toBeNull();
    expect(body.indexOf(flag![0])).toBeGreaterThan(matchAt);
    // The phone is hashed inside the guarded block, never in DECLARE (a salt
    // error there would stop the email and identity bans too).
    const declare = /DECLARE([\s\S]*?)\bBEGIN\b/i.exec(body)![1];
    expect(declare).not.toMatch(/ban_fingerprint\(\s*'phone'/i);
    const hashAt = body.search(/v_phone_h\s*:=\s*public\.ban_fingerprint\(\s*'phone'/i);
    expect(hashAt).toBeGreaterThan(-1);
    expect(body.lastIndexOf("BEGIN", hashAt)).toBeGreaterThan(matchAt);
    expect(body.slice(hashAt, body.indexOf(flag![0]))).not.toMatch(/\bEXCEPTION\b/i);
    expect(body.slice(body.indexOf(flag![0]))).toMatch(/EXCEPTION\s+WHEN\s+OTHERS\s+THEN/i);
    // Test accounts are skipped (they share fixture numbers).
    expect(body.slice(matchAt, hashAt)).toMatch(/NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.profiles\s+pr\s+WHERE\s+pr\.user_id\s*=\s*p_user_id\s+AND\s+COALESCE\(\s*pr\.is_seed\s*,\s*false\s*\)\s*\)/i);
    expect(body.slice(body.indexOf(flag![0]))).toMatch(/RETURN\s+jsonb_build_object\(\s*'banned'\s*,\s*false\s*,\s*'matched_on'\s*,\s*'phone'\s*,\s*'flagged'\s*,\s*true\s*\)/i);
  });

  it("flag_possible_ban_evasion_by_phone files the exact number on INSERT as well as UPDATE", () => {
    const body = code("flag_possible_ban_evasion_by_phone");
    expect(body).toMatch(/WHERE\s+\(\s*phone7_sha256\s*=\s*v_h7\s+OR\s+phone_sha256\s*=\s*v_full\s*\)/i);
    // No UPDATE-only condition on the exact number (it skipped INSERT while sign-up banned on it).
    expect(body).not.toMatch(/TG_OP\s*=\s*'UPDATE'\s+(?:AND|OR)\s+phone_sha256/i);
    // Test accounts share fixture numbers and are skipped (lh-authz-rls review #4).
    expect(body).toMatch(/IF\s+COALESCE\(\s*NEW\.is_seed\s*,\s*false\s*\)\s+THEN\s+RETURN\s+NULL/i);
    const t = [...triggers.values()].find((x) => x.table === "profiles" && x.fn === "flag_possible_ban_evasion_by_phone");
    expect(t, "the doubt-check trigger still stands").toBeDefined();
    expect(t!.timing).toBe("AFTER");
    expect(t!.events).toMatch(/\bINSERT\b/);
    expect(t!.events).toMatch(/\bUPDATE\s+OF\b[\s\S]*\bphone\b/i);
  });

  it("an expired email or identity ban is retired and the phone is still checked; the test accounts' old doubt-checks are resolved", () => {
    const body = code("enforce_retained_ban");
    expect(body).toMatch(/v_retired\s*:=\s*true\s*;/i);
    // No early return on a retirement: it skipped the phone (lh-authz-rls review #2).
    expect(body).not.toMatch(/RETURN\s+jsonb_build_object\(\s*'banned'\s*,\s*false\s*,\s*'matched_on'\s*,\s*NULL\s*,\s*'retired'\s*,\s*true\s*\)/i);
    expect(body).toMatch(/IF\s+v_retired\s+OR\s+NOT\s+v_found\s+THEN/i);
    const src = blankSqlComments(sqlOf(stmt("enforce_retained_ban").file));
    expect(src).toMatch(/UPDATE\s+public\.ban_evasion_matches\s+m\s+SET\s+resolved\s*=\s*true[\s\S]*?is_seed[\s\S]*?matched_on\s+IN\s*\(\s*'phone'\s*,\s*'phone_near'\s*\)[\s\S]*?NOT\s+m\.resolved/i);
  });

  it("Q1497: the ban's match record marks a doubt-check already filed for the same match (auto_banned)", () => {
    const body = code("enforce_retained_ban");
    const inserts = [...body.matchAll(/INSERT\s+INTO\s+public\.ban_evasion_matches[\s\S]*?;/gi)].map((m) => m[0]);
    expect(inserts.some((s) => /ON\s+CONFLICT\s*\(\s*user_id\s*,\s*matched_on\s*,\s*retained_ban_id\s*\)\s*DO\s+UPDATE\s+SET\s+auto_banned\s*=\s*true/i.test(s)),
      "enforce_retained_ban no longer marks the doubt-check its ban takes over").toBe(true);
    // The one-time backfill of rows already stuck at false stays in the file that ran it.
    const backfill = blankSqlComments(sqlOf("20261012065930_retained_ban_marks_doubt_row.sql"));
    expect(backfill).toMatch(/UPDATE\s+public\.ban_evasion_matches\s+m\s+SET\s+auto_banned\s*=\s*true[\s\S]*?NOT\s+m\.auto_banned[\s\S]*?ban_status\s+IN/i);
    const src = blankSqlComments(sqlOf(stmt("enforce_retained_ban").file));
    expect(src).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.enforce_retained_ban\(uuid,\s*text,\s*text,\s*text\)\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated\s*;/i);
  });
});
