import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative } from "node:path";

/**
 * High-risk writes must be able to observe their own row count.
 *
 * An UPDATE that matches ZERO rows is not an error in Postgres. RLS filtered
 * the row out, the id was stale, a BEFORE-UPDATE trigger reverted it, or a
 * guard predicate no longer held — and PostgREST answers
 * `{ data: [], error: null }`. So `const { error } = await supabase.from(X)
 * .update(…)` proceeds to the success path over a row that never changed.
 *
 * Every serious defect in the last audit was that exact shape: escrow releases,
 * ban ladders, recurring schedules, a business-invite claim, an admin queue
 * whose resolve() updated nothing and reported success. Each was found by hand,
 * months apart, because nothing in the build could see them.
 *
 * This test can. It is deliberately NARROW: it only fires on updates that touch
 * a column from RISK_COLUMNS — money, escrow, job/dispute status, bans,
 * violations, verification and approval state — the writes whose silent no-op
 * costs money, trust, or safety. A broad "every mutation needs .select()" rule
 * would be mostly false positives (preferences, read-receipts, pins) and would
 * be allowlisted into uselessness within a month.
 *
 * Fixing an offender: add `.select("id")` to the chain and wrap the result in
 * `unwrapMutation()` from `src/lib/mutationResult.ts`. If zero rows is a
 * LEGITIMATE outcome for that write (a deliberately conditional
 * `.eq("status", "pending")` race), add it to ALLOWLIST with the reason.
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
 * Writes that are deliberately unguarded, with the reason. Anything added here
 * is a decision, not a backlog item — a zero-row result must be a legitimate,
 * expected outcome at that call site.
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

/** Read the balanced-parens argument that starts at `open` (index of "("). */
function balanced(src: string, open: number): { arg: string; end: number } {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return { arg: src.slice(open + 1, i), end: i };
    }
  }
  return { arg: src.slice(open), end: src.length };
}

interface Offender {
  file: string;
  line: number;
  column: string;
}

function findOffenders(): Offender[] {
  const offenders: Offender[] = [];
  for (const file of sourceFiles(srcRoot)) {
    const src = stripComments(readFileSync(file, "utf8"));
    const rel = relative(repoRoot, file);
    const re = /\.update\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const openParen = m.index + m[0].length - 1;
      const { arg, end } = balanced(src, openParen);

      // The chain continues until the statement ends. `.select(` anywhere in
      // that tail means the affected rows come back and can be counted.
      const tailEnd = src.indexOf(";", end);
      const tail = src.slice(end, tailEnd === -1 ? end + 400 : tailEnd);
      if (/\.\s*select\s*\(/.test(tail)) continue;

      const hit = RISK_COLUMNS.find((col) =>
        new RegExp(`(^|[^\\w])${col}\\s*:`).test(arg),
      );
      if (!hit) continue;
      if (ALLOWLIST[rel]) continue;

      offenders.push({
        file: rel,
        line: src.slice(0, m.index).split("\n").length,
        column: hit,
      });
    }
  }
  return offenders;
}

describe("high-risk mutations can observe their own row count", () => {
  it("has no unguarded write to a money / status / moderation column", () => {
    const offenders = findOffenders();
    const detail = offenders
      .map((o) => `  ${o.file}:${o.line} — sets "${o.column}" with no .select()`)
      .join("\n");

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : `\n${offenders.length} high-risk write(s) cannot tell whether they changed anything.\n` +
            `A zero-row UPDATE returns { data: [], error: null } — the caller proceeds as if it worked.\n\n` +
            `${detail}\n\n` +
            `Fix: add .select("id") to the chain and wrap it in unwrapMutation() from ` +
            `src/lib/mutationResult.ts.\n` +
            `If zero rows is a legitimate outcome there, add the file to ALLOWLIST in ` +
            `src/test/mutationRowGuard.test.ts with the reason.\n`,
    ).toEqual([]);
  });

  it("keeps the allowlist honest — every entry names a file that still exists", () => {
    const live = new Set(sourceFiles(srcRoot).map((f) => relative(repoRoot, f)));
    const stale = Object.keys(ALLOWLIST).filter((f) => !live.has(f));
    expect(stale, `Allowlist entries for files that no longer exist: ${stale.join(", ")}`).toEqual(
      [],
    );
  });
});
