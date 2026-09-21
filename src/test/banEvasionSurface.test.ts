import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A refused ban-evasion attempt has to be silent to the person and loud to the
 * operator. Both halves are easy to break in the direction that produces no
 * error: a helpful message turns the refusal into a lookup oracle, and a flag
 * written to a type no filter lists is a record nobody will ever read.
 *
 * Owner decision, 2026-09-07: reach is email + phone + verified Stripe Identity
 * fingerprint; the user message is plain; the full detail goes to admins.
 *
 * COVERAGE LIMIT, on the record: every SQL assertion here reads the MIGRATION
 * TEXT. A `CREATE OR REPLACE` typed straight into the live database, or a
 * policy dropped there, is invisible to this file. Verifying the deployed body
 * needs `pg_get_functiondef` against prod, which no test does.
 *
 * @mutate supabase/migrations/20260908010034_unban_never_released_the_fingerprint.sql | DELETE FROM public.retained_bans\n       WHERE COALESCE(retained_via, 'ban') <> 'deletion' | PERFORM 1; -- DELETE FROM public.retained_bans WHERE COALESCE(retained_via, 'ban') <> 'deletion'
 * @mutate supabase/migrations/20260908010034_unban_never_released_the_fingerprint.sql | WHERE (v_email_h IS NOT NULL AND email_sha256    = v_email_h) | WHERE (v_email_h IS NOT NULL AND FALSE)
 */

const ROOT = resolve(__dirname, "../..");
const repoFile = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");

/**
 * Strip SQL `--` comments, leaving `--` inside single-quoted literals alone.
 * A text pin satisfiable by a comment is not a pin: `-- DELETE FROM
 * public.retained_bans` would otherwise read as a release that happens.
 * Doubled quotes (`''`) close-then-reopen, which lands in the same state.
 */
function stripSqlComments(sql: string): string {
  let out = "";
  let inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (inStr) {
      out += c;
      if (c === "'") inStr = false;
      continue;
    }
    if (c === "'") {
      inStr = true;
      out += c;
      continue;
    }
    if (c === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    out += c;
  }
  return out;
}

/**
 * THE BODY OF ONE FUNCTION — its LAST `CREATE OR REPLACE`, bounded at the
 * closing dollar-quote, comments stripped.
 *
 * This used to return the WHOLE migration file, which is the shape the money
 * lane found in the `job_tracking` policy test: an assertion "about" one object
 * satisfied by a different object further down the same file. Proven here
 * 2026-09-20 — `20260908010034` defines `retain_ban_on_ban`,
 * `reject_self_issued_ban` AND `enforce_retained_ban`, plus a repair `DO` block
 * that also deletes from `retained_bans`. Replacing the entire pardon-release
 * inside `retain_ban_on_ban` with `PERFORM 1;` — so a pardoned user is silently
 * re-banned on their next signup, exactly the bug that migration exists to
 * fix — left this guard 6/6 GREEN, because the repair block satisfied both
 * `DELETE FROM public.retained_bans` and `retained_via <> 'deletion'`. The same
 * hole made `enforce_retained_ban`'s `email_sha256` / `phone_sha256` /
 * `identity_sha256` reach assertions satisfiable by its two neighbours.
 */
function liveDefinition(fn: string): string {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  // Match the CREATE itself — a COMMENT ON / REVOKE names the function too and
  // sorts later, so "the last file that mentions it" is the wrong file.
  const creator = new RegExp(`CREATE OR REPLACE FUNCTION\\s+public\\.${fn}\\s*\\(`, "gi");
  let latest: string | null = null;
  for (const f of files) {
    const body = readFileSync(resolve(MIGRATIONS, f), "utf8");
    creator.lastIndex = 0;
    if (creator.test(body)) latest = body;
  }
  if (!latest) throw new Error(`no migration ever CREATEs public.${fn}`);

  // Within that file, the LAST create wins too (a file may restate a function).
  creator.lastIndex = 0;
  let start = -1;
  let m: RegExpExecArray | null;
  while ((m = creator.exec(latest)) !== null) start = m.index;

  const from = latest.slice(start);
  const tag = /\bAS\s+(\$[A-Za-z_]*\$)/.exec(from);
  if (!tag) throw new Error(`public.${fn}: no dollar-quoted body found after its CREATE`);
  const bodyStart = tag.index + tag[0].length;
  const close = from.indexOf(tag[1], bodyStart);
  if (close === -1) throw new Error(`public.${fn}: body opened with ${tag[1]} is never closed`);
  return stripSqlComments(from.slice(0, close + tag[1].length));
}

describe("ban evasion: quiet to the user, complete to the admin", () => {
  it("the refusal names no signal, no date and no prior account", () => {
    const fn = repoFile("supabase/functions/complete-signup/index.ts");
    const refusal = fn.match(/error:\s*\n?\s*`This account can't be created[^`]*`/);
    expect(
      refusal,
      "complete-signup no longer refuses a retained ban with the plain message. " +
        "The owner's decision (2026-09-07) is that the user is told nothing beyond " +
        "'This account can't be created' plus the support address.",
    ).not.toBeNull();

    // The specific leaks that shipped once and must not come back. Each of
    // these turns the endpoint into a free lookup service: feed it phone
    // numbers or addresses, learn which belong to banned accounts.
    for (const leak of [
      /This phone number belongs to/i,
      /was (removed|banned|suspended)/i,
      /previous(ly)? (account|banned)/i,
      /matched_on/,
    ]) {
      expect(
        leak.test(fn.slice(fn.indexOf("retained-ban check"), fn.indexOf("MAX_FILE_SIZE"))),
        `the retained-ban refusal in complete-signup leaks ${leak} to the person being ` +
          `refused. Everything it withholds is in the ban_evasion_attempt fraud flag instead.`,
      ).toBe(false);
    }

    // The support address must be the one the app actually shows, not a
    // hand-typed support@… nobody reads.
    expect(
      fn,
      "the refusal hard-codes a support address instead of using SUPPORT_EMAIL",
    ).toMatch(/import \{ SUPPORT_EMAIL \} from "\.\.\/_shared\/resend\.ts"/);
    expect(fn).toMatch(/Contact support at \$\{SUPPORT_EMAIL\}/);
  });

  it("every refusal path files an admin record, because the RPC files it", () => {
    const live = liveDefinition("enforce_retained_ban");

    // Written centrally. When stripe-idv-webhook wrote its own, the email match
    // in handle_new_user — the oldest path — recorded nothing at all.
    expect(
      live,
      "enforce_retained_ban no longer writes the fraud flag itself, so any caller " +
        "that forgets to becomes a silent re-ban with no operator record.",
    ).toMatch(/INSERT INTO public\.fraud_flags[\s\S]{0,600}'ban_evasion_attempt'/);

    // The three facts an operator needs, and the one they must not be given
    // (the prior account's raw identifiers, which are salted hashes and are not
    // recoverable by design).
    expect(live, "the flag no longer names which signal matched").toMatch(/matched a ban retained on %s/);
    expect(live, "the flag no longer names the attempted email").toMatch(/Attempted email: %s/);
    expect(live, "the flag no longer carries the original ban's date").toMatch(/v_row\.retained_at/);
    expect(live, "the flag no longer carries the original ban's reason").toMatch(/v_row\.reason/);

    // Not stacked per retry — a console that grows a row per attempt is
    // unreadable exactly when it matters.
    expect(
      live,
      "the fraud-flag insert lost its de-duplication; a retry loop would flood the console",
    ).toMatch(/WHERE NOT EXISTS[\s\S]{0,400}'ban_evasion_attempt'/);

    // Enforcement must outlive a reporting failure.
    expect(
      live,
      "the fraud-flag insert is no longer guarded — a fraud_flags failure would now " +
        "abort the whole check and let the evasion through",
    ).toMatch(/EXCEPTION WHEN OTHERS THEN\s*\n\s*RAISE NOTICE 'enforce_retained_ban: fraud flag failed/);
  });

  it("the flag lands somewhere an admin can actually find and read it", () => {
    const dash = repoFile("src/components/admin/AdminFraudDashboard.tsx");

    // That file's own rule is that only written types belong in the filter.
    // This is the converse: a type that IS written must be listed, or it lands
    // in a table no filter can surface.
    expect(
      dash,
      "enforce_retained_ban writes ban_evasion_attempt but the fraud console has no " +
        "filter for it — the flag is invisible to the operator it exists for.",
    ).toMatch(/value: "ban_evasion_attempt"/);

    expect(
      dash,
      "ban_evasion_attempt has no severity tone, so it renders as a neutral chip " +
        "beside genuinely minor flags",
    ).toMatch(/ban_evasion_attempt: "danger"/);

    // The details string is a structured record, not a sentence. Clamped to two
    // lines, the half an operator acts on is hidden — and it is the ONLY place
    // any of it is visible, since the person refused is told none of it.
    expect(
      dash,
      "ban_evasion_attempt details are being line-clamped again; the matched signal, " +
        "original ban and attempted email would be cut off",
    ).toMatch(/flag\.flag_type === "ban_evasion_attempt"[\s\S]{0,200}whitespace-pre-line/);

    // A refused signup is refused BEFORE the profile write, so `full_name` is
    // empty by construction for this flag type — every row headlined "Unknown"
    // until the email fallback existed. Verified on the running console at 375.
    expect(
      dash,
      "the fraud console stopped falling back to the account email, so every " +
        "ban_evasion_attempt row headlines 'Unknown' again",
    ).toMatch(/emailMap\.get\(f\.user_id\)/);
    expect(dash, "the profiles hydration no longer selects email").toMatch(
      /select\("user_id, full_name, email"\)/,
    );
  });

  it("a pardon releases the fingerprints, and a deletion never does", () => {
    const live = liveDefinition("retain_ban_on_ban");

    // The bug this pins: retention was one-way, inherited from the deletion
    // case where one-way is correct. An admin lifting a ban left the
    // fingerprints on file and the pardoned user was re-banned on their next
    // signup, quoting the original reason, with no admin action to explain it.
    expect(
      live,
      "retain_ban_on_ban no longer releases retained_bans when an account leaves a " +
        "banned status — a pardoned user will be silently re-banned on next signup",
    ).toMatch(/DELETE FROM public\.retained_bans/);

    expect(
      live,
      "the release stopped exempting retained_via = 'deletion'. Those accounts are " +
        "gone and have no unban path; releasing them undoes 20260903014600 entirely.",
    ).toMatch(/retained_via[\s\S]{0,40}<>\s*'deletion'/);

    // Guarded, like its twin: a release that throws must not roll back the pardon.
    expect(
      live,
      "the release is no longer guarded — a failure would roll back the unban itself",
    ).toMatch(/RAISE NOTICE 'retain_ban_on_ban: release failed/);
  });

  it("a ban names the admin who issued it", () => {
    const live = liveDefinition("reject_self_issued_ban");
    expect(live, "the self-ban guard stopped comparing banned_by to user_id").toMatch(
      /NEW\.banned_by = NEW\.user_id/,
    );
    // The one carve-out: the retained re-application has no admin to name,
    // because the issuing account no longer exists.
    expect(live, "the retained-ban carve-out is gone; re-application would now fail").toMatch(
      /app\.retained_ban_reapply/,
    );
    // ...and it must be transaction-local, or it becomes a way to write any
    // self-issued ban.
    const enforce = liveDefinition("enforce_retained_ban");
    expect(
      enforce,
      "app.retained_ban_reapply is no longer set with is_local => true, so the " +
        "exemption can leak to later writes in the same session",
    ).toMatch(/set_config\('app\.retained_ban_reapply', 'on', true\)/);
  });

  it("reach is email + phone + identity, and nothing wider", () => {
    const live = liveDefinition("enforce_retained_ban");
    for (const key of ["email_sha256", "phone_sha256", "identity_sha256"]) {
      expect(live, `enforce_retained_ban stopped checking ${key}`).toContain(key);
    }

    // Owner decision: no device or IP matching. Those signals are shared by
    // households, coffee shops and carrier NAT, so they ban strangers — and
    // this test exists because "one more signal" is a tempting one-line change.
    const migrationText = readdirSync(MIGRATIONS)
      .filter((f) => f.includes("ban_") || f.includes("_ban"))
      .map((f) => readFileSync(resolve(MIGRATIONS, f), "utf8"))
      .join("\n");
    for (const forbidden of [/\bip_sha256\b/, /\bdevice_sha256\b/, /\bdevice_fingerprint\b/]) {
      expect(
        forbidden.test(migrationText),
        `a ${forbidden} key was added to the retained-ban machinery. The owner ruled ` +
          `reach is email + phone + verified identity only (2026-09-07): IP and device ` +
          `are shared by households and carrier NAT, so they refuse strangers.`,
      ).toBe(false);
    }
  });
});
