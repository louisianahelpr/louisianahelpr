import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative } from "node:path";

/**
 * High-risk writes must be able to observe their own row count.
 *
 * An UPDATE or DELETE that matches ZERO rows is not an error in Postgres. RLS
 * filtered the row out, the id was stale, a BEFORE-UPDATE trigger reverted it,
 * or a guard predicate no longer held — and PostgREST answers
 * `{ data: [], error: null }`. So `const { error } = await supabase.from(X)
 * .update(…)` proceeds to the success path over a row that never changed, and
 * `… .delete()` reports a removal that removed nothing.
 *
 * Every serious defect in the last audit was that exact shape: escrow releases,
 * ban ladders, recurring schedules, a business-invite claim, an admin queue
 * whose resolve() updated nothing and reported success. Each was found by hand,
 * months apart, because nothing in the build could see them.
 *
 * This test can. It is deliberately NARROW, and narrow in a DIFFERENT way for
 * each verb, because the two verbs carry different evidence:
 *
 *   * UPDATE has a payload, so it is narrowed by RISK_COLUMNS — money, escrow,
 *     job/dispute status, bans, violations, verification and approval state.
 *   * DELETE has NO payload. Nothing about `.delete().eq("id", id)` says what
 *     it was removing, so a column list cannot classify it at all. It is
 *     narrowed by RISK_TABLES instead: the tables where "the row is gone" is a
 *     claim the user or an admin will act on.
 *
 * A broad "every mutation needs .select()" rule would be mostly false positives
 * (preferences, read-receipts, pins, drafts) and would be allowlisted into
 * uselessness within a month.
 *
 * Fixing an offender: add `.select("id")` to the chain and wrap the result in
 * `unwrapMutation()` from `src/lib/mutationResult.ts`. If zero rows is a
 * LEGITIMATE outcome for that write (a deliberately conditional
 * `.eq("status", "pending")` race), add it to ALLOWLIST / DELETE_ALLOWLIST
 * with the reason.
 */

const repoRoot = resolve(__dirname, "../..");
const srcRoot = resolve(repoRoot, "src");

/**
 * Columns whose value is money, escrow state, lifecycle position, or a
 * moderation/verification verdict. A write that sets one of these and cannot
 * tell whether it landed is the bug this test exists to catch.
 */
const RISK_COLUMNS = [
  // money / escrow
  "amount",
  "budget",
  "cancellation_fee",
  "cancellation_fee_status",
  "payout",
  "payout_split",
  "platform_fee",
  "refund",
  "tip_amount",
  "transfer_status",
  // job + dispute lifecycle
  "status",
  "cancelled_at",
  "completed_at",
  "disputed_at",
  "dispute_resolved_at",
  "helper_completed_at",
  "helper_id",
  // moderation / consequence ladder
  "ban_status",
  "banned_at",
  "is_active",
  "auto_suspended_until",
  "violation_count",
  // verification / credentials
  "approval_status",
  "idv_status",
  "license_status",
  "insurance_status",
  "verification_status",
];

/**
 * Tables where "this row is gone" is a claim someone ACTS ON.
 *
 * A DELETE carries no payload, so RISK_COLUMNS is structurally unable to
 * classify one — `.delete().eq("id", id)` says nothing about what it removed.
 * The equivalent narrowing for a delete is the TABLE: the question is not
 * "which column did this touch" but "if this removed nothing and said it
 * worked, what does someone now believe that is false?"
 *
 * A table earns a place here when a silent no-op leaves a user or an admin
 * acting on a removal that never happened — a privilege still held, a person
 * still blocked, a helper still attached to a paid job, a message the sender
 * believes is gone but the recipient can still read, an orphaned unfunded job
 * live in the marketplace, a device still receiving another person's pushes.
 *
 * A table stays OUT when the no-op is self-correcting or self-evident: a
 * preference, a pin, an archive flag, a saved search, a read receipt, a draft,
 * a delete-then-insert pair whose insert repairs the delete, or a list the
 * screen re-fetches from the server immediately after (a stale row is back on
 * screen within the same interaction, so nobody is misled). Those are the
 * false positives that would get this test allowlisted into uselessness.
 *
 * Entries with no delete site in src/ today are deliberate: the whole failure
 * mode is that the FIRST unguarded delete against one of these ships green.
 */
const RISK_TABLES = [
  // Money, escrow, and the marketplace objects money is attached to. A job
  // that survives its own post-payment-failure cleanup goes live unfunded;
  // a withdrawn application, a removed group-job helper, a deleted tip or
  // credit that quietly stayed put all move money or a claim on money.
  "jobs",
  "applications",
  "group_job_helpers",
  "tips",
  "payment_refunds",
  "payout_transfers",
  "instant_payouts",
  "pif_credits",
  // "time_credits" was here until migration 20260901035602 retired the
  // table (self-mint RLS, and nothing ever minted or spent a credit).
  "referral_credits",
  "disputes",
  // "job_disputes" was here until migration
  // 20260904034410_drop_dead_features_instant_book_skills_reminders_dup_disputes
  // dropped the table — a duplicate of "disputes" with zero readers.
  // Moderation, safety, and the consequence ladder. Deleting one of these
  // LIFTS a consequence: a ban, a shadowban, a strike, a fraud flag, a block
  // between two people who asked not to be in contact, a safety report.
  // "It didn't actually delete" and "it deleted when it shouldn't have" are
  // both incidents; only the first one is currently invisible.
  "user_bans",
  "helper_shadowbans",
  "user_strikes",
  "user_violations",
  "fraud_flags",
  "user_blocks",
  "reports",
  // Privilege. Removing an admin is the lock-everyone-out half of the same
  // primitive as granting one; a no-op means the person you just "removed"
  // still has the console.
  "user_roles",
  // Verification and credentials. Deleting one of these revokes standing —
  // a licence, an insurance doc, an IDV check, a manual exception that grants
  // access. A revocation that didn't land is a helper still trading on it.
  "helper_credentials",
  "helper_verifications",
  "verification_checks",
  "verification_exceptions",
  // Privacy and user-owned lists — the cases where the user, not the system,
  // is the one who will be wrong. A push token that outlived a sign-out sends
  // the next person's notifications to the previous person's device
  // (F-PRIV-01). A message the sender deleted but the recipient can still
  // read is the same shape. A saved-helper row is here for the same reason and
  // NOT as a preference: the poster removes a helper from their shortlist
  // after a bad job, and a silent no-op keeps re-suggesting them.
  "push_tokens",
  "messages",
  "favorite_helpers",
];

/**
 * Writes that are deliberately unguarded, with the reason. Anything added here
 * is a decision, not a backlog item — a zero-row result must be a legitimate,
 * expected outcome at that call site.
 *
 * UPDATES ONLY — see DELETE_ALLOWLIST for the delete side. The two are separate
 * on purpose: this list is full of files forgiven for a COSMETIC update
 * (read receipts, unread badges, push-token registration), and a single
 * per-file allowlist would have handed each of those a free pass on any
 * delete they also make. `src/lib/nativePush.ts` is the live example — it is
 * forgiven here for a token upsert, and its `push_tokens` DELETE is a
 * different call needing its own, differently-reasoned decision.
 */
const ALLOWLIST: Record<string, string> = {
  "src/pages/activity/activityActions/useOfferHandlers.ts":
    "declineApplication is deliberately conditional on .eq(\"status\", \"pending\") — a zero-row " +
    "result means the application was already resolved in another tab, which is the intended race outcome.",
  "src/components/admin/adminusers/useAdminUserActions.ts":
    "unbanUser's user_bans .eq(\"is_active\", true) legitimately matches zero rows when there is no " +
    "active ban row; the authoritative profiles.ban_status write beside it IS guarded.",
  "src/components/admin/AdminBroadcasts.tsx":
    "Broadcast scheduling — admin-only content management, no money/trust consequence to a no-op.",
  "src/components/admin/AdminNotifications.tsx":
    "Notification-preference toggles; a no-op is self-evident on the next render.",
  "src/components/NotificationPreferences.tsx":
    "Notification-preference upserts; a no-op is self-evident on the next render.",
  "src/pages/messages/useMessagesData.ts":
    "Read-receipt / unread-count writes — cosmetic, and re-run on every poll.",
  "src/pages/messages/useMessagesRealtime.ts":
    "Read-receipt writes — cosmetic, and re-run on every realtime event.",
  "src/components/mobileNav/useNavUnreadCount.ts":
    "Unread-badge writes — cosmetic, and re-run on every poll.",
  "src/components/NotificationPanel.tsx":
    "Mark-as-read writes — cosmetic, and re-run on the next open.",
  "src/lib/nativePush.ts":
    "Push-token registration; retried on every app foreground.",
  "src/components/HelperAvailability.tsx":
    "Availability rows are delete-then-insert on every save; a stale delete is corrected by the insert.",
  "src/components/SavedSearches.tsx":
    "Saved-search bookkeeping — no money/trust consequence to a no-op.",
  "src/pages/StrSettings.tsx":
    "Calendar-connection bookkeeping — a no-op surfaces on the next sync.",
  "src/pages/petProfiles/PetForm.tsx":
    "Pet profile content — a no-op is visible immediately on the form.",
  "src/pages/PetProfiles.tsx":
    "Pet profile content — a no-op is visible immediately in the list.",
  "src/pages/postjob/useJobMediaUpload.ts":
    "Media-URL attachment during the post flow; the draft is retried and the images are re-uploadable.",
  "src/components/profile/savedHelpersTab/useSavedHelpers.ts":
    "Favourite-helper bookkeeping — no money/trust consequence to a no-op.",
};

/**
 * DELETEs against a RISK_TABLES table that are deliberately unguarded, with the
 * reason. Same bar as ALLOWLIST: zero rows must be a legitimate, EXPECTED
 * outcome at that call site — not merely an inconvenient one to handle.
 */
const DELETE_ALLOWLIST: Record<string, string> = {
  "src/lib/nativePush.ts":
    "unregisterPushOnSignOut deletes push_tokens for a device that very often has no row: the " +
    "user never granted push, or already signed out on this device, or is on web (where no row " +
    "is ever written). Zero rows is the common, correct outcome, so a row-count assertion would " +
    "fire on the happy path. Stated in the code at the call site too. The RISK_TABLES entry for " +
    "push_tokens still earns its place — it exists to catch the next, targeted token delete.",
};

/** Source files that ship to users. Generated edge mirrors and tests excluded. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // src/test/edge/*.gen.ts are generated mirrors of the edge functions —
      // they run under the service role, where RLS does not apply.
      if (entry === "edge") continue;
      sourceFiles(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.(test|spec)\.tsx?$/.test(entry)) continue;
    if (/\.gen\.ts$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

/**
 * Blank out comments while preserving offsets, so line numbers stay accurate.
 *
 * Without this the scanner reports code QUOTED IN COMMENTS — useApplyFlow.ts
 * documents the exact broken `.update({ helper_id, status: "accepted" })` that
 * this test exists to prevent, and got flagged for describing it.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, lead) => lead + " ".repeat(m.length - lead.length));
}

/** Read the balanced `open…close` span that starts at `open` (index of the opener). */
function balancedFrom(
  src: string,
  start: number,
  openCh: string,
  closeCh: string,
): { body: string; end: number } {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === openCh) depth++;
    else if (c === closeCh) {
      depth--;
      if (depth === 0) return { body: src.slice(start + 1, i), end: i };
    }
  }
  return { body: src.slice(start), end: src.length };
}

/**
 * Every syntactic shape a PostgREST `update` can be *reached* through.
 *
 * The scanner used to be a bare `/\.update\s*\(/`, and it did not match
 *
 *     await (supabase.from("jobs").update as any)(updates).eq("id", id)
 *
 * which is precisely how AdminJobs' manual status override — setting `status`
 * and `cancelled_at` on a job, then telling BOTH parties it had changed —
 * went unguarded past a green build. A scanner that misses a real shape is
 * worse than no scanner, because it certifies the codebase as clean.
 *
 * Two things hid that call:
 *   1. `x.update as any` turns the METHOD into a value, so the call parens
 *      belong to the cast expression and the literal `.update(` never occurs.
 *   2. the payload was a NAMED object (`updates`), built up over the following
 *      lines with `updates.cancelled_at = …`, so even once the call site was
 *      found, a scan of the argument text alone saw no risk column.
 * Both are handled below — {@link argListOpen} for (1), {@link payloadText}
 * for (2).
 *
 * Bracket access (`x["update"](…)`) costs nothing to cover and is the obvious
 * next way around a dot-anchored regex, so it is covered too.
 *
 * `.delete()` used to be listed here as a known, deliberate gap: same bug
 * class, but no payload, so RISK_COLUMNS could not classify it. It is now
 * COVERED, via RISK_TABLES and {@link fromTable} — see DELETE_MEMBER below.
 *
 * NOT covered, deliberately:
 *   * `.upsert(…)` — an upsert INSERTs when nothing matched, so "matched zero
 *     rows and silently did nothing" is not a state it can reach. (None of
 *     the eleven upserts in src/ pass `ignoreDuplicates`, which would be the
 *     exception.) Adding it would only import false positives: the
 *     home-maintenance-reminder upsert sets `is_active`, a
 *     reminder-enabled flag that shares its name with the ban column.
 *     Extending the scanner to DELETE does not disturb this reasoning: an
 *     upsert's insert fallback is exactly what a delete lacks.
 */
const UPDATE_MEMBER = /(?:\.\s*update\b|\[\s*["']update["']\s*\])/g;

/**
 * The same shapes, for `delete`. Reuses {@link argListOpen}, so the cast form
 * (`(supabase.from(t).delete as any)()`) and the bracket form
 * (`x["delete"]()`) are covered on this verb too.
 *
 * `.delete` is a far noisier token than `.update`: `Set`, `Map`,
 * `URLSearchParams` and the Cache API all have one, and src/ has ~55 of those
 * against 19 PostgREST deletes. {@link fromTable} is what separates them — a
 * match only counts if a `.from("table")` sits in the same statement, which is
 * also how the table name (the only classifying evidence a delete carries)
 * is recovered.
 */
const DELETE_MEMBER = /(?:\.\s*delete\b|\[\s*["']delete["']\s*\])/g;

/**
 * Index of the `(` that opens the argument list for a write member at `from`,
 * or -1 if this occurrence is not a call.
 *
 * Handles the direct form (`.update(`) and the cast form
 * (`(… .update as any)(`), where the cast's own closing paren sits between
 * the member and the call.
 */
function argListOpen(src: string, from: number): number {
  const direct = /^\s*\(/.exec(src.slice(from, from + 40));
  if (direct) return from + direct[0].length - 1;

  // `as any)(`, `as unknown as Foo)(`, `as unknown as ((p: X) => Y))(` …
  const cast = /^\s*as\s+[^;{}()]*(?:\([^()]*\)[^;{}()]*)*\)\s*\(/.exec(src.slice(from, from + 300));
  if (cast) return from + cast[0].length - 1;

  return -1;
}

/**
 * The text to search for risk columns, given a call's raw argument source.
 *
 * A payload passed by NAME or spread in (`update(updates)`,
 * `update({ ...patch })`) hides its columns from a literal-only scan. So for
 * those two shapes — and only those two, to keep unrelated same-named consts
 * out — we append what the file builds into that name: its object-literal
 * initializer, plus every later `id.col = …` / `id["col"] = …` assignment.
 */
function payloadText(src: string, rawArg: string): string {
  // `update(payload as never)` — strip the assertion before asking whether
  // what is left is a bare identifier.
  const arg = rawArg.replace(/\s+as\s+[\w$.<>[\]|&'" ]+$/, "").trim();
  let text = arg;

  const named = new Set<string>();
  if (/^[A-Za-z_$][\w$]*$/.test(arg)) named.add(arg);
  for (const m of arg.matchAll(/\.\.\.\s*([A-Za-z_$][\w$]*)/g)) named.add(m[1]);

  for (const id of named) {
    const decl = new RegExp(`\\b(?:const|let|var)\\s+${id}\\b[^=;]*=\\s*\\{`).exec(src);
    if (decl) {
      // The declaration regex ends ON the `{`, so its own end locates the
      // literal — safer than searching forward for the next brace.
      text += "\n" + balancedFrom(src, decl.index + decl[0].length - 1, "{", "}").body;
    }
    const assign = new RegExp(
      `\\b${id}\\s*(?:\\.\\s*([\\w$]+)|\\[\\s*["']([\\w$]+)["']\\s*\\])\\s*=(?!=)`,
      "g",
    );
    for (const m of src.matchAll(assign)) text += `\n${m[1] ?? m[2]}: ,`;
  }

  return text;
}

/**
 * The PostgREST table a write member at `memberIndex` is chained onto, or null
 * if it isn't chained onto one at all.
 *
 * A delete's only classifying evidence is its table, and the table is named
 * upstream in the chain — sometimes on the same line
 * (`supabase.from("jobs").delete()`), sometimes three lines above, sometimes
 * behind a cast (`(supabase.from("thread_archives" as any) as any).delete()`).
 *
 * Scope: the enclosing STATEMENT, bounded by the nearest preceding `;`, `{` or
 * `}`. That bound is what keeps `next.delete(id)` inside a `setState` updater
 * from being credited to the `supabase.from(…)` call four lines above it — a
 * whole-file backward search would match nearly every Set and URLSearchParams
 * delete in the codebase. `Array.from(` is excluded explicitly.
 */
function fromTable(src: string, memberIndex: number): string | null {
  let stmtStart = 0;
  for (const ch of [";", "{", "}"]) {
    const i = src.lastIndexOf(ch, memberIndex);
    if (i + 1 > stmtStart) stmtStart = i + 1;
  }
  let table: string | null = null;
  for (const m of src
    .slice(stmtStart, memberIndex)
    .matchAll(/(?<!Array)\.\s*from\s*\(\s*["']([\w]+)["']/g)) {
    table = m[1];
  }
  return table;
}

interface Hit {
  file: string;
  line: number;
  kind: "update" | "delete";
  /** The risk column (update) or risk table (delete) that made this a hit. */
  reason: string;
  /** Present only in the dump; the guard itself skips allowlisted files. */
  allowlisted: boolean;
}

function findHits(includeAllowlisted = false): Hit[] {
  const hits: Hit[] = [];
  for (const file of sourceFiles(srcRoot)) {
    const src = stripComments(readFileSync(file, "utf8"));
    const rel = relative(repoRoot, file);

    for (const kind of ["update", "delete"] as const) {
      const member = kind === "update" ? UPDATE_MEMBER : DELETE_MEMBER;
      member.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = member.exec(src))) {
        const openParen = argListOpen(src, m.index + m[0].length);
        if (openParen === -1) continue;
        const { body: arg, end } = balancedFrom(src, openParen, "(", ")");

        // The chain continues until the statement ends. `.select(` anywhere in
        // that tail means the affected rows come back and can be counted.
        const tailEnd = src.indexOf(";", end);
        const tail = src.slice(end, tailEnd === -1 ? end + 400 : tailEnd);
        if (/\.\s*select\s*\(/.test(tail)) continue;

        let reason: string | undefined;
        if (kind === "update") {
          const payload = payloadText(src, arg);
          reason = RISK_COLUMNS.find((col) =>
            new RegExp(`(^|[^\\w])${col}\\s*:`).test(payload),
          );
        } else {
          // A delete carries no payload; the table is the whole signal. A
          // `.delete` with no `.from("…")` in its statement is a Set / Map /
          // URLSearchParams / Cache delete, not a PostgREST one.
          const table = fromTable(src, m.index);
          reason = table && RISK_TABLES.includes(table) ? table : undefined;
        }
        if (!reason) continue;

        const allowlisted = !!(kind === "update" ? ALLOWLIST : DELETE_ALLOWLIST)[rel];
        if (allowlisted && !includeAllowlisted) continue;

        hits.push({
          file: rel,
          line: src.slice(0, m.index).split("\n").length,
          kind,
          reason,
          allowlisted,
        });
      }
    }
  }
  return hits.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

const findOffenders = (): Hit[] => findHits(false);

const describeHit = (h: Hit): string =>
  h.kind === "update"
    ? `sets "${h.reason}" with no .select()`
    : `deletes from "${h.reason}" with no .select()`;

describe("high-risk mutations can observe their own row count", () => {
  it("has no unguarded write to a money / status / moderation column or table", () => {
    const offenders = findOffenders();
    const detail = offenders.map((o) => `  ${o.file}:${o.line} — ${describeHit(o)}`).join("\n");

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : `\n${offenders.length} high-risk write(s) cannot tell whether they changed anything.\n` +
            `A zero-row UPDATE or DELETE returns { data: [], error: null } — the caller proceeds ` +
            `as if it worked.\n\n` +
            `${detail}\n\n` +
            `Fix: add .select("id") to the chain and wrap it in unwrapMutation() from ` +
            `src/lib/mutationResult.ts.\n` +
            `If zero rows is a legitimate outcome there, add the file to ALLOWLIST (updates) or ` +
            `DELETE_ALLOWLIST (deletes) in src/test/mutationRowGuard.test.ts with the reason.\n`,
    ).toEqual([]);
  });

  // Auditing the guard itself: the assertion above prints only FAILURES, so
  // there is otherwise no way to see what the scanner matched and chose to
  // forgive. `MUTATION_GUARD_DUMP=1 npx vitest run src/test/mutationRowGuard.test.ts`
  // lists every match, allowlisted ones included, for a hit-by-hit review.
  it.runIf(!!process.env.MUTATION_GUARD_DUMP)("dumps every matched write", () => {
    const all = findHits(true);
    console.log(
      `\n${all.length} unguarded risk write(s) matched across src/:\n` +
        all
          .map(
            (h) =>
              `  ${h.allowlisted ? "[allowlisted] " : "[OFFENDER]    "}` +
              `${h.kind.toUpperCase().padEnd(6)} ${h.file}:${h.line} — ${h.reason}`,
          )
          .join("\n") +
        "\n",
    );
    expect(Array.isArray(all)).toBe(true);
  });

  it("keeps the allowlists honest — every entry names a file that still exists", () => {
    const live = new Set(sourceFiles(srcRoot).map((f) => relative(repoRoot, f)));
    const stale = [...Object.keys(ALLOWLIST), ...Object.keys(DELETE_ALLOWLIST)].filter(
      (f) => !live.has(f),
    );
    expect(stale, `Allowlist entries for files that no longer exist: ${stale.join(", ")}`).toEqual(
      [],
    );
  });
});
