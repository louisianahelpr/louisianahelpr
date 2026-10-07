/**
 * Q1324 CLASS GUARD: a ban keeps EVERY key it is matched on, and each key does
 * what the owner decided (2026-10-05): card and bank AUTO-BAN, a name only
 * raises an admin doubt-check flag.
 *
 * Read from the migrations (comments blanked, any dollar-quote tag, the
 * definition the migrations actually leave: effectiveDefs / triggerInventory).
 * The SQL behaviour itself is proven by src/test/pglite/banEvasionCardBankName.pglite.mjs
 * (red on the live state with NEW_MIGRATION=skip: 30 FAIL; green after); the
 * edge half by src/test/edge/banEvasionPaymentFingerprint.test.ts.
 *
 *   1. INVENTORY, from source: every `*_sha256` column retained_bans has ever
 *      been given (CREATE TABLE + every ALTER TABLE ... ADD COLUMN). Each one
 *      is written by retain_ban_for_user, the one body both ban paths run
 *      (trg_retain_ban_on_ban at ban time, retain_ban_on_deletion before the
 *      purge), and both still delegate to it. A key added later and never
 *      retained is the gap this item closed for cards, banks and names.
 *   2. Card and bank are matched by enforce_retained_payment_ban, which bans
 *      the way enforce_retained_ban does (profiles.ban_status, the
 *      user_bans re-application, a ban_evasion_attempt flag) and never sets
 *      banned_until (banned users keep sign-in).
 *   3. The name trigger only ever files possible_ban_evasion: it writes no ban
 *      status, no user_bans row, and never raises (a signup must not fail).
 *   4. The fraud console can show possible_ban_evasion in full.
 *
 * @mutate supabase/migrations/20261007043626_ban_evasion_phone_and_identity_near_match.sql |     v_cards,\n    v_banks,\n    v_name_h, |     '{}'::text[],\n    v_banks,\n    v_name_h,
 * @mutate supabase/migrations/20261007043626_ban_evasion_phone_and_identity_near_match.sql |    email_sha256, phone_sha256, identity_sha256, card_sha256, bank_sha256, name_sha256, |    email_sha256, phone_sha256, identity_sha256, card_sha256, bank_sha256,
 * @mutate supabase/migrations/20261006014801_ban_evasion_card_bank_and_name.sql |        OR (p_kind = 'bank' AND v_h = ANY (rb.bank_sha256))) |        OR FALSE)
 * @mutate supabase/migrations/20261006014801_ban_evasion_card_bank_and_name.sql |       VALUES (NEW.user_id, 'name', v_h, v_row.id, | INSERT INTO public.fraud_flags (user_id, flag_type, details) VALUES (NEW.user_id, 'possible_ban_evasion', v_row.reason);\n      VALUES (NEW.user_id, 'name', v_h, v_row.id,
 * @mutate supabase/migrations/20261006014801_ban_evasion_card_bank_and_name.sql |     IF FOUND THEN\n      -- Admin-only | IF FOUND THEN\n      UPDATE public.profiles SET ban_status = 'banned' WHERE user_id = NEW.user_id;\n      -- Admin-only
 * @mutate supabase/migrations/20261006014801_ban_evasion_card_bank_and_name.sql |   AFTER INSERT OR UPDATE OF full_name ON public.profiles |   AFTER UPDATE OF full_name ON public.profiles
 * @mutate supabase/migrations/20261006014801_ban_evasion_card_bank_and_name.sql |         COALESCE(v_email, '(unknown)')\n      )\n    WHERE NOT EXISTS ( |         COALESCE(v_email, '(unknown)') \|\| v_row.reason\n      )\n    WHERE NOT EXISTS (
 * @mutate supabase/migrations/20261006014801_ban_evasion_card_bank_and_name.sql |            v_own_reason,\n           p_user_id, |            v_row.reason,\n           p_user_id,
 * @mutate supabase/migrations/20261006014801_ban_evasion_card_bank_and_name.sql |   -- Q1324: a fingerprint-match ban waits for an admin (ban_settlement_queue).\n  IF COALESCE(current_setting('app.ban_settlement_review', true), '') = 'on' THEN\n    RETURN NULL;\n  END IF;\n  -- Belt | -- Belt
 * @mutate supabase/migrations/20261007044339_ban_review_keeps_strikes.sql |                        AND NOT EXISTS (SELECT 1 FROM public.payout_transfers pt\n                                        WHERE pt.job_id = j.id AND pt.helper_id = r.user_id AND pt.status = 'paid'))), '[]'::jsonb) |                        TRUE)), '[]'::jsonb)
 * @mutate src/components/admin/AdminFraudDashboard.tsx |       <AdminBanEvasionReview /> |
 * @mutate supabase/migrations/20261006030849_ban_review_freezes_money_hides_posts_neutral_reason.sql |                 WHERE q.review_state = 'open' AND q.user_id IN (v_customer, v_helper, NEW.helper_id)) THEN | WHERE false) THEN
 * @mutate supabase/migrations/20261006030849_ban_review_freezes_money_hides_posts_neutral_reason.sql |   BEFORE UPDATE OF payment_status ON public.jobs |   AFTER UPDATE OF payment_status ON public.jobs
 * @mutate supabase/migrations/20261006030849_ban_review_freezes_money_hides_posts_neutral_reason.sql |                          current_setting('app.ban_settlement_as_of', true)::timestamptz); |                          now());
 * @mutate supabase/migrations/20261007044339_ban_review_keeps_strikes.sql |     PERFORM set_config('app.ban_settlement_as_of', v_review.created_at::text, true); |     PERFORM 1;
 * @mutate supabase/migrations/20261006014801_ban_evasion_card_bank_and_name.sql |        SET ban_status           = 'banned',\n           auto_suspended_until = NULL |        SET ban_status           = v_row.ban_status,\n           auto_suspended_until = v_row.expires_at
 * @mutate supabase/migrations/20261007044339_ban_review_keeps_strikes.sql |   IF p_admin_id IS NULL OR NOT public.has_role(p_admin_id, 'admin'::public.app_role) THEN |   IF p_admin_id IS NULL THEN
 * @mutate supabase/migrations/20261007044339_ban_review_keeps_strikes.sql |      AND COALESCE(current_setting('app.ban_review_lift', true), '') <> 'on' |      AND false
 * @mutate supabase/migrations/20261006030849_ban_review_freezes_money_hides_posts_neutral_reason.sql |      OR EXISTS (SELECT 1 FROM public.ban_settlement_queue q WHERE q.user_id = v_job.customer_id AND q.review_state = 'open')\n  THEN |   THEN
 * @mutate supabase/migrations/20261007033530_seed_switch_hides_test_profiles.sql |   IF EXISTS (SELECT 1 FROM public.ban_settlement_queue q\n              WHERE q.user_id = v_job.customer_id AND q.review_state = 'open') THEN | IF false THEN
 * @mutate supabase/migrations/20261006030849_ban_review_freezes_money_hides_posts_neutral_reason.sql |       ('ban settlement review',                     'ban-settlement-review') |       ('ban settlement reviewx',                    'ban-settlement-review')
 * @mutate supabase/migrations/20261006030849_ban_review_freezes_money_hides_posts_neutral_reason.sql |           v_own_reason,\n           p_user_id, |           v_row.reason,\n           p_user_id,
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
const body = (fn: string) => {
  const d = defs.get(fn);
  if (!d) throw new Error(`no migration leaves public.${fn}`);
  return bodyOf(d.stmt);
};

/** Every *_sha256 column retained_bans has been given, from CREATE TABLE and ADD COLUMN. */
function retainedHashColumns(): string[] {
  const cols = new Set<string>();
  for (const f of files) {
    const code = blankSqlComments(sqlOf(f));
    for (const st of code.split(";")) {
      if (/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?retained_bans\b/i.test(st)) {
        for (const m of st.matchAll(/(?:^|[(,\s])(\w+_sha256)\s+text\b/gi)) cols.add(m[1].toLowerCase());
      }
      if (/alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?retained_bans\b/i.test(st)) {
        for (const m of st.matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+_sha256)\b/gi)) cols.add(m[1].toLowerCase());
      }
    }
  }
  return [...cols].sort();
}

/** Split on commas outside parentheses and string literals. */
function splitTopLevel(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr = false;
  let cur = "";
  for (const ch of list) {
    if (inStr) {
      cur += ch;
      if (ch === "'") inStr = false;
      continue;
    }
    if (ch === "'") inStr = true;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

describe("Q1324: a ban keeps every key, and each key does what the owner decided", () => {
  it("every retained hash column is written by retain_ban_for_user (inventory from the migrations)", () => {
    const cols = retainedHashColumns();
    // Floor (2026-10-05): email, phone, identity, card, bank, name.
    expect(cols.length).toBeGreaterThanOrEqual(6);
    expect(cols).toEqual(expect.arrayContaining(["card_sha256", "bank_sha256", "name_sha256"]));

    const retain = body("retain_ban_for_user");
    const insert = /insert\s+into\s+public\.retained_bans\s*\(([^)]*)\)\s*values\s*\(([\s\S]*?)\)\s*on\s+conflict/i.exec(retain);
    expect(insert, "retain_ban_for_user no longer inserts into retained_bans").not.toBeNull();
    const insertCols = insert![1].split(",").map((c) => c.trim().toLowerCase());
    const values = splitTopLevel(insert![2]);
    expect(values.length, "the VALUES list no longer lines up with the column list").toBe(insertCols.length);
    for (const c of cols) {
      expect(insertCols, `retain_ban_for_user does not retain ${c}`).toContain(c);
      const v = values[insertCols.indexOf(c)] ?? "";
      expect(v, `retain_ban_for_user writes a constant into ${c} instead of the account's key`).not.toMatch(/^(null|'\{\}'.*)$/i);
      // A re-retention must never drop a key an earlier one captured (the
      // conflict key itself is the one exception: it IS the row).
      if (c === "email_sha256") continue;
      expect(retain, `the ON CONFLICT branch does not keep ${c}`).toMatch(new RegExp(`${c}\\s*=\\s*(?:COALESCE|ARRAY|encode)`, "i"));
    }
    expect(retain, "cards and banks are not read from payment_fingerprints").toMatch(/from\s+public\.payment_fingerprints/i);
  });

  it("both ban paths still run retain_ban_for_user", () => {
    expect(body("retain_ban_on_ban")).toMatch(/retain_ban_for_user\s*\(\s*NEW\.user_id/i);
    expect(body("retain_ban_on_deletion")).toMatch(/retain_ban_for_user\s*\(\s*p_user_id\s*,\s*'deletion'\s*\)/i);
    const trg = triggerInventory(files.map((name) => ({ name, sql: sqlOf(name) }))).get("profiles.trg_retain_ban_on_ban");
    expect(trg?.fn).toBe("retain_ban_on_ban");
  });

  it("a card or bank match bans the account the same way every other key does", () => {
    const enforce = body("enforce_retained_payment_ban");
    expect(enforce).toMatch(/p_kind\s*=\s*'card'\s+AND\s+v_h\s*=\s*ANY\s*\(\s*(?:rb\.)?card_sha256\s*\)/i);
    expect(enforce).toMatch(/p_kind\s*=\s*'bank'\s+AND\s+v_h\s*=\s*ANY\s*\(\s*(?:rb\.)?bank_sha256\s*\)/i);
    // While the review is open: 'banned', no end date; the confirm applies
    // the retained judgment (admin_confirm_ban_settlement).
    expect(enforce, "the match no longer sets profiles.ban_status").toMatch(/update\s+public\.profiles\s+set\s+ban_status\s*=\s*'banned'/i);
    expect(enforce, "the match no longer writes the user_bans re-application").toMatch(/app\.retained_ban_reapply[\s\S]{0,600}insert\s+into\s+public\.user_bans/i);
    expect(enforce, "the match no longer files ban_evasion_attempt").toMatch(/insert\s+into\s+public\.fraud_flags[\s\S]{0,200}'ban_evasion_attempt'/i);
    expect(enforce, "banned users keep sign-in: never banned_until").not.toMatch(/banned_until/i);
    expect(enforce, "only Stripe fingerprints, salted").toMatch(/public\.ban_fingerprint\s*\(\s*p_kind\s*,\s*p_stripe_fingerprint\s*\)/i);
  });

  it("a name match only records it for admins: no ban status, no user_bans, nothing exportable, never raises", () => {
    const flag = body("flag_possible_ban_evasion_by_name");
    expect(flag).toMatch(/insert\s+into\s+public\.ban_evasion_matches[\s\S]{0,300}'name'/i);
    expect(flag, "a name match must not write fraud_flags: export_my_data hands those to the person").not.toMatch(/insert\s+into\s+public\.fraud_flags/i);
    expect(flag, "the name check writes a ban").not.toMatch(/\bban_status\s*=|insert\s+into\s+public\.user_bans|update\s+public\.profiles|enforce_retained/i);
    expect(flag, "the name check can abort a signup").not.toMatch(/\bRAISE\b(?!\s+(?:WARNING|NOTICE|LOG|INFO|DEBUG)\b)/i);
    expect(flag).toMatch(/EXCEPTION\s+WHEN\s+OTHERS/i);

    const trg = triggerInventory(files.map((name) => ({ name, sql: sqlOf(name) }))).get("profiles.trg_flag_possible_ban_evasion_by_name");
    expect(trg?.fn).toBe("flag_possible_ban_evasion_by_name");
    expect(trg?.timing.toLowerCase()).toBe("after");
    expect(trg?.events.toLowerCase()).toMatch(/insert/);
    expect(trg?.events.toLowerCase()).toMatch(/update/);
  });

  // Q1413 (lh-money-escrow review of fbdfa47c7 #1): a strike the ladder earns
  // while a review is open is kept on the review row and applied by the lift /
  // confirm, never dropped. Behaviour: banEvasionCardBankName.pglite.mjs
  // (NEW_MIGRATION=skip-strikes: 4 FAIL).
  // @mutate supabase/migrations/20261007044339_ban_review_keeps_strikes.sql |     v_status := v_review.deferred_ban_status;\n | NULL;\n
  // @mutate supabase/migrations/20261007044339_ban_review_keeps_strikes.sql |      AND EXISTS (SELECT 1 FROM public.user_violations v\n                  WHERE v.user_id = p_user_id AND v.created_at >= v_review.created_at) THEN |      THEN
  // @mutate supabase/migrations/20261007044339_ban_review_keeps_strikes.sql |     UPDATE public.ban_settlement_queue r\n       SET deferred_ban_status = NEW.ban_status, |     UPDATE public.ban_settlement_queue r\n       SET deferred_at = now(),
  it("a strike earned during an open review is kept and applied when the review ends (Q1413)", () => {
    const refuse = body("refuse_unban_during_ban_review");
    const record = refuse.search(/update\s+public\.ban_settlement_queue\s+r\s+set\s+deferred_ban_status\s*=\s*new\.ban_status/i);
    const keep = refuse.search(/-- 1\.|new\.ban_status\s*:=\s*old\.ban_status/i);
    expect(record, "the ladder's deferred standing is recorded on the open review").toBeGreaterThan(-1);
    expect(record, "recorded before any branch keeps the old standing").toBeLessThan(keep);
    expect(refuse).toMatch(/app\.trusted_ladder_write[\s\S]{0,600}update\s+public\.ban_settlement_queue/i);
    expect(body("lift_ban_settlement_review")).toMatch(/ban_standing_rank\(v_review\.deferred_ban_status\)\s*>\s*public\.ban_standing_rank\(p_ban_status\)/i);
    expect(body("lift_ban_settlement_review")).toMatch(/set\s+ban_status\s*=\s*v_status/i);
    // A strike an admin reversed during the review takes its standing with it.
    expect(body("lift_ban_settlement_review")).toMatch(/exists\s*\(select\s+1\s+from\s+public\.user_violations\s+v\s+where\s+v\.user_id\s*=\s*p_user_id\s+and\s+v\.created_at\s*>=\s*v_review\.created_at\)/i);
    expect(readFileSync(join(ROOT, "supabase/functions/admin-user-actions/index.ts"), "utf8")).toMatch(/update\.ban_status = applied\.ban_status/);
    expect(body("admin_confirm_ban_settlement")).toMatch(/deferred_ban_status/i);
    expect(body("admin_ban_settlement_reviews")).toMatch(/'strikes_during_review'/);
  });

  // Q1416 (owner 2026-10-05 / 2026-10-07): the phone (same last 7 digits)
  // and ID (same name + date of birth, any document) NEAR-matches only record
  // an admin doubt-check, like the name. Behaviour:
  // src/test/pglite/banEvasionCardBankName.pglite.mjs (NEW_MIGRATION=skip-near: 11 FAIL).
  // @mutate supabase/migrations/20261007043626_ban_evasion_phone_and_identity_near_match.sql | a last-7 match as 'phone_near'.\n      VALUES (NEW.user_id, | a last-7 match as 'phone_near'.\n      INSERT INTO public.user_bans (user_id, ban_type, reason, banned_by) VALUES (NEW.user_id, 'banned', 'x', NEW.user_id);\n      VALUES (NEW.user_id,
  // @mutate supabase/migrations/20261007043626_ban_evasion_phone_and_identity_near_match.sql |   AFTER INSERT OR UPDATE OF phone ON public.profiles |   AFTER UPDATE OF phone ON public.profiles
  // @mutate supabase/migrations/20261007043626_ban_evasion_phone_and_identity_near_match.sql |   SELECT CASE WHEN length(d) >= 7 THEN right(d, 7) ELSE NULL END |   SELECT CASE WHEN length(d) >= 7 THEN d ELSE NULL END
  it("phone and ID near-matches only record it for admins (Q1416)", () => {
    for (const [fn, kind] of [["flag_possible_ban_evasion_by_phone", "phone_near"], ["flag_possible_ban_evasion_by_identity", "identity_near"]] as const) {
      const flag = body(fn);
      expect(flag).toMatch(new RegExp(`insert\\s+into\\s+public\\.ban_evasion_matches[\\s\\S]{0,700}'${kind}'`, "i"));
      expect(flag, `${fn} writes fraud_flags`).not.toMatch(/insert\s+into\s+public\.fraud_flags/i);
      expect(flag, `${fn} writes a ban`).not.toMatch(/\bban_status\s*=|insert\s+into\s+public\.user_bans|update\s+public\.profiles|enforce_retained/i);
    }
    expect(body("flag_possible_ban_evasion_by_phone"), "the phone check can abort a profile edit").not.toMatch(/\bRAISE\b(?!\s+(?:WARNING|NOTICE|LOG|INFO|DEBUG)\b)/i);
    expect(body("normalize_phone7_for_ban")).toMatch(/right\(d,\s*7\)/i);
    const trg = triggerInventory(files.map((name) => ({ name, sql: sqlOf(name) }))).get("profiles.trg_flag_possible_ban_evasion_by_phone");
    expect(trg?.fn).toBe("flag_possible_ban_evasion_by_phone");
    expect(trg?.timing.toLowerCase()).toBe("after");
    expect(trg?.events.toLowerCase()).toMatch(/insert/);
    expect(trg?.events.toLowerCase()).toMatch(/update/);
    // The webhook supplies the document-free hash (identity_fingerprint with no document).
    const idv = readFileSync(join(ROOT, "supabase/functions/stripe-idv-webhook/index.ts"), "utf8");
    expect(idv).toMatch(/p_doc_number: null,[\s\S]{0,600}flag_possible_ban_evasion_by_identity/);
  });

  /**
   * lh-authz-rls (2026-10-05): fraud_flags and user_bans rows are exported to
   * the person they are about (export_my_data), so no function may copy a
   * retained ban's reason, date or id into one. CLASS, from the migrations:
   * every function whose newest body reads public.retained_bans and inserts
   * into fraud_flags or user_bans. EXACT exemption list, with why.
   */
  it("no exported row carries another account's ban reason, date or retained id", () => {
    // No exemption (owner 2026-10-05 supersedes 2026-09-07): enforce_retained_ban's
    // email / phone / identity matches are neutral too.
    const readers = [...defs.keys()].filter((fn) => /from\s+public\.retained_bans\b/i.test(body(fn)));
    expect(readers.length, "inventory floor: the retained-ban readers were found").toBeGreaterThanOrEqual(4);
    const offenders: string[] = [];
    for (const fn of readers) {
      // String literals blanked: a ';' inside message text must not end the
      // statement early (that hid a v_row.reason appended after one).
      const b = body(fn).replace(/'(?:[^']|'')*'/g, "''");
      for (const m of b.matchAll(/insert\s+into\s+public\.(fraud_flags|user_bans)\b[^;]*;/gi)) {
        if (/v_row\.(reason|retained_at|id)\b/i.test(m[0])) offenders.push(`${fn} -> ${m[1]}`);
      }
    }
    expect(readers, "enforce_retained_ban is a reader").toContain("enforce_retained_ban");
    expect(offenders.sort()).toEqual([]);
    // The other account's details go to the admin-only table instead.
    for (const fn of ["enforce_retained_payment_ban", "enforce_retained_ban"]) {
      expect(body(fn), `${fn} no longer keeps the details for admins`).toMatch(/insert\s+into\s+public\.ban_evasion_matches[\s\S]{0,500}v_row\.reason/i);
    }
  });

  /**
   * Owner 2026-10-05, "ban now, admin settles": a card / bank ban settles no
   * job. The two permanent-ban settlement triggers skip while
   * app.ban_settlement_review is on, and ONLY enforce_retained_payment_ban
   * sets it (an admin's manual ban keeps settling at once).
   */
  it("a fingerprint ban waits for an admin; every other ban settles as before", () => {
    for (const fn of ["settle_one_off_jobs_on_permanent_ban", "end_series_on_permanent_ban"]) {
      expect(body(fn), `${fn} no longer waits for the review`).toMatch(
        /IF\s+COALESCE\(current_setting\('app\.ban_settlement_review',\s*true\),\s*''\)\s*=\s*'on'\s+THEN\s+RETURN\s+NULL;/i,
      );
    }
    const setters = [...defs.keys()].filter((fn) => /set_config\(\s*'app\.ban_settlement_review'\s*,\s*'on'/i.test(body(fn)));
    // The confirm sets it around its own status write, then settles explicitly.
    expect(setters.sort()).toEqual(["admin_confirm_ban_settlement", "enforce_retained_payment_ban"]);
    const enforce = body("enforce_retained_payment_ban");
    expect(enforce).toMatch(/set_config\('app\.ban_settlement_review',\s*'on',\s*true\);\s*UPDATE\s+public\.profiles/i);
    expect(enforce, "the review is not opened").toMatch(/insert\s+into\s+public\.ban_settlement_queue/i);
    expect(enforce, "the account can still get paid").toMatch(/insert\s+into\s+public\.payout_holds/i);
    expect(body("admin_confirm_ban_settlement")).toMatch(/settle_one_off_jobs_for_banned_account\(p_user_id\)[\s\S]{0,200}end_series_for_banned_account\(p_user_id\)/i);
  });

  /**
   * No job is stranded: the admin queue lists exactly the jobs the settlement
   * acts on. The queue's job predicate must equal
   * settle_one_off_jobs_for_banned_account's own (with its user parameter).
   */
  it("the admin review lists every job the settlement would act on (same predicate)", () => {
    const norm = (sql: string) => sql.replace(/\s+/g, " ").trim();
    const settle = body("settle_one_off_jobs_for_banned_account");
    const s = /FROM public\.jobs j\s+WHERE\s+([\s\S]*?)\s+ORDER BY j\.id/i.exec(settle)?.[1];
    expect(s, "settlement predicate not found").toBeTruthy();
    const queue = body("admin_ban_settlement_reviews");
    const q = /FROM public\.jobs j\s+WHERE\s+([\s\S]*?)\),\s*'\[\]'::jsonb\)/i.exec(queue)?.[1];
    expect(q, "review job predicate not found").toBeTruthy();
    expect(norm(q!)).toBe(norm(s!.split("p_user").join("r.user_id")));
  });

  it("the fraud console shows the review queue and the name matches", () => {
    const dash = readFileSync(join(ROOT, "src/components/admin/AdminFraudDashboard.tsx"), "utf8");
    expect(dash).toMatch(/<AdminBanEvasionReview \/>/);
    const review = readFileSync(join(ROOT, "src/components/admin/AdminBanEvasionReview.tsx"), "utf8");
    expect(review).toMatch(/rpc\("admin_ban_settlement_reviews"\)/);
    expect(review).toMatch(/rpc\("admin_confirm_ban_settlement"/);
    // Q1416: every doubt-check kind (name, phone_near, identity_near), never an auto-ban kind.
    expect(review).toMatch(/from\("ban_evasion_matches"\)[\s\S]{0,260}\.in\("matched_on", \[\.\.\.DOUBT_CHECK_KINDS\]\)/);
    const kinds = /const DOUBT_CHECK_LABEL = \{([\s\S]*?)\} as const;/.exec(review)?.[1] ?? "";
    expect([...kinds.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort()).toEqual(["identity_near", "name", "phone", "phone_near"]);
    expect(review).toMatch(/\.in\("matched_on", \[\.\.\.DOUBT_CHECK_KINDS\]\)\s*(?:\/\/[^\n]*\n\s*)*\.eq\("auto_banned", false\)/);
    expect(dash, "possible_ban_evasion is no longer a fraud_flags type").not.toMatch(/value: "possible_ban_evasion"/);
  });
  /**
   * lh-money-escrow re-review of f943c56b3: while a review is OPEN, every job
   * of the account (as poster and as Helpr) moves no money: no transfer claim
   * (refuse_payout_claim_while_held), no escrow -> payout_pending
   * (trg_refuse_payout_pending_during_ban_review); the crons skip it
   * (src/test/edge/banReviewFreezesMoney.test.ts). A confirm prices the
   * settlement as of the ban.
   */
  it("an open review freezes the account's money, and a confirm settles as of the ban", () => {
    const claim = body("refuse_payout_claim_while_held");
    expect(claim).toMatch(/ban_settlement_queue q[\s\S]{0,120}review_state = 'open'[\s\S]{0,80}q\.user_id IN \(v_customer, v_helper, NEW\.helper_id\)/);
    expect(claim).toMatch(/RAISE EXCEPTION 'payout_held'[\s\S]{0,200}ban settlement review/);
    const freeze = body("refuse_payout_pending_during_ban_review");
    expect(freeze).toMatch(/q\.review_state = 'open'/);
    expect(freeze).toMatch(/group_job_helpers/);
    const files = migrationFiles(MIG).map((name) => ({ name, sql: sqlOf(name) }));
    const trg = triggerInventory(files).get("jobs.trg_refuse_payout_pending_during_ban_review");
    expect(trg?.fn).toBe("refuse_payout_pending_during_ban_review");
    expect(trg?.timing.toLowerCase()).toBe("before");
    const settle = body("settle_one_off_jobs_for_banned_account");
    expect(settle).toMatch(/current_setting\('app\.ban_settlement_as_of', true\)::timestamptz\)/);
    const confirm = body("admin_confirm_ban_settlement");
    expect(confirm).toMatch(/set_config\('app\.ban_settlement_as_of', v_review\.created_at::text, true\);\s*v_out := public\.settle_one_off_jobs_for_banned_account\(p_user_id\)/);
  });

  /**
   * authz re-review: only an attributable ADMIN unban closes a review or clears
   * a match; nothing else may unban during an open review, and while open the
   * account has no end date for an expiry to lift.
   */
  it("only an admin lift ends a review; an expiry cannot", () => {
    const enforce = body("enforce_retained_payment_ban");
    expect(enforce, "a review ban must have no end date").toMatch(/SET ban_status\s+= 'banned',\s+auto_suspended_until = NULL/);
    const lift = body("lift_ban_settlement_review");
    expect(lift).toMatch(/NOT public\.has_role\(p_admin_id, 'admin'::public\.app_role\)[\s\S]{0,80}admin_only/);
    expect(lift).toMatch(/review_state IN \('open', 'confirmed'\)/);
    expect(lift).toMatch(/set_config\('app\.ban_review_lift', 'on', true\)/);
    const guard = body("refuse_unban_during_ban_review");
    expect(guard).toMatch(/current_setting\('app\.ban_review_lift', true\)/);
    const files = migrationFiles(MIG).map((name) => ({ name, sql: sqlOf(name) }));
    const inv = triggerInventory(files);
    expect(inv.get("profiles.trg_refuse_unban_during_ban_review")?.fn).toBe("refuse_unban_during_ban_review");
    expect(inv.has("profiles.trg_close_ban_settlement_review_on_unban"), "an unban trigger would let an expiry lift a review").toBe(false);
    const setters = [...defs.keys()].filter((fn) => /set_config\(\s*'app\.ban_review_lift'\s*,\s*'on'/i.test(body(fn)));
    expect(setters).toEqual(["lift_ban_settlement_review"]);
    const edge = readFileSync(join(ROOT, "supabase/functions/admin-user-actions/index.ts"), "utf8");
    expect(edge).toMatch(/admin\.rpc\('lift_ban_settlement_review', \{\s*p_user_id: targetUserId,\s*p_admin_id: userData\.user\.id,/);
  });

  /**
   * Q1411 (owner 2026-10-05): while the poster is under an open review, their
   * open posts are on no browse surface and take no new application. CLASS,
   * from the migrations: every function whose newest body spells the browse
   * gate (reads seed_jobs_hidden_publicly() and offered_to_helper_id) carries
   * the review clause, or is listed here with why. The view is pinned by
   * jobAnnouncementsApplyBrowseGate.test.ts (its nine conjuncts).
   */
  it("Q1411: every browse-gate spelling hides a poster under review (inventory from the migrations)", () => {
    const NOT_A_SURFACE: Record<string, string> = {
      notify_helpers_on_job_post: "fires when a job is posted or funded; a banned account cannot post, and the queue it fills is delivered through job_announceable_to",
      notify_saved_searches_on_new_job: "same: only queues; delivery is deliver_saved_search_alert, which carries the clause",
      direct_accept_block_reason: "explains a refusal to the offered Helpr; the accept's own application insert is refused by enforce_application_job_state C13",
    };
    // Q552: the gate is also spelled through the test-account carve-out predicates.
    const spellers = [...defs.keys()].filter((fn) => /(?:seed_jobs_hidden_publicly\(\)|seed_hidden_in_discovery\(\)|seed_hidden_for\()/.test(body(fn)) && /offered_to_helper_id/.test(body(fn)));
    expect(spellers.length, "inventory floor").toBeGreaterThanOrEqual(7);
    const missing = spellers.filter((fn) => !NOT_A_SURFACE[fn] && !/ban_settlement_queue q\s+WHERE q\.user_id = [a-z_.]*customer_id AND q\.review_state = 'open'/.test(body(fn)));
    expect(missing).toEqual([]);
    for (const fn of Object.keys(NOT_A_SURFACE)) expect(spellers, `stale NOT_A_SURFACE ${fn}`).toContain(fn);
    expect(body("enforce_application_job_state")).toMatch(/q\.user_id = v_job\.customer_id AND q\.review_state = 'open'\) THEN\s*RAISE EXCEPTION 'job_not_available'/);
  });

  it("an open review pages, and its admin alerts close themselves", () => {
    expect(body("enforce_retained_payment_ban")).toMatch(/'admin_alert'[\s\S]{0,200}INSERT INTO public\.error_logs/);
    const sweep = body("sweep_open_ban_settlement_reviews");
    expect(sweep).toMatch(/created_at < now\(\) - interval '24 hours'/);
    expect(sweep).toMatch(/'fatal'/);
    expect(body("admin_alert_close_rule")).toMatch(/'ban settlement review',\s+'ban-settlement-review'/);
    expect(body("admin_queue_still_pending")).toMatch(/p_rule = 'ban-settlement-review' THEN\s+RETURN EXISTS \(SELECT 1 FROM public\.ban_settlement_queue q WHERE q\.review_state = 'open'\)/);
  });
});

// Second authz re-review (f2644839e): the retained-ban path could soften a ban
// from a client-triggered complete-signup call, its open-review exemption never
// applied (flag set after the write), and any caller-less unban was taken for
// the expiry sweep. Proven in banEvasionCardBankName.pglite.mjs; pinned here so
// a later restatement cannot drop them.
// @mutate supabase/migrations/20261006030849_ban_review_freezes_money_hides_posts_neutral_reason.sql |     IF v_new_rank > v_cur_rank | IF true OR v_new_rank > v_cur_rank
// @mutate supabase/migrations/20261006035830_ban_review_decides_standing.sql |       PERFORM set_config('app.ban_expiry_sweep', 'on', true); |       NULL;
describe("the retained-ban path never softens a ban, and only the sweep finishes a caller-less unban", () => {
  it("enforce_retained_ban sets its flag before the profile write and applies only a stricter judgment", () => {
    const fn = body("enforce_retained_ban");
    const flag = fn.indexOf("set_config('app.retained_ban_reapply', 'on', true)");
    const write = fn.indexOf("UPDATE public.profiles");
    expect(flag).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(flag);
    expect(fn.slice(flag, write)).toMatch(/IF v_new_rank > v_cur_rank/);
  });
  it("the expiry sweep names itself, and the finish trigger requires that name from a caller-less unban", () => {
    expect(body("sweep_expired_auto_bans")).toMatch(/set_config\('app\.ban_expiry_sweep', 'on', true\);\s+UPDATE public\.profiles/);
    // A NULL uid alone is not the server (db-smoke's null-uid-trust gate): the sweep's flag counts only in a server context.
    expect(body("finish_confirmed_ban_review_on_unban")).toMatch(/IF v_actor IS NULL\s+AND NOT \(public\.is_server_context\(\)\s+AND COALESCE\(current_setting\('app\.ban_expiry_sweep', true\), ''\) = 'on'\) THEN\s+RETURN NULL;/);
  });
});
