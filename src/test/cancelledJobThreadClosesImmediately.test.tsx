/**
 * A CANCELLED JOB'S THREAD CLOSES IMMEDIATELY — AND SAYS SO HONESTLY.
 *
 * ── THE BUG (verified live on prod with pg_get_functiondef, 2026-09-19) ────
 * `can_message_in_job` gates on
 *   `COALESCE(public.job_messaging_closes_at(_job_id) > now(), true)`
 * and `job_messaging_closes_at` ended `AND j.status = 'completed'`. A
 * CANCELLED job therefore matched no row → NULL → `NULL > now()` is NULL →
 * the outer COALESCE fell through to `true`. **Messaging on a cancelled job
 * stayed open forever**, while completed jobs locked at +24h.
 *
 * Owner's ruling: close it immediately on cancellation.
 *
 * ── THE CLASS, not the instance ────────────────────────────────────────────
 * Three separate defect classes are guarded here, because all three were live
 * in this one bug:
 *
 *   1. A NULL-ABLE COLUMN USED AS A GATE ANCHOR. `jobs.cancelled_at` is
 *      nullable; anchoring on it bare reproduces the exact bug on legacy
 *      rows — NULL anchor, NULL comparison, COALESCE says "open". Prod had 0
 *      such rows on 2026-09-19, but "zero today" is not a constraint.
 *   2. A SERVER GATE THE CLIENT CANNOT SEE. `get_messaging_closes_at` carried
 *      the same `status = 'completed'` filter, so fixing only the gate would
 *      leave the composer offering a Send the server refuses — the
 *      fail-on-tap pattern this codebase has explicitly rejected.
 *   3. COPY THAT NAMES THE WRONG EVENT. The closed notice states a rule
 *      ("messaging ends 24 hours after a job is completed") that is false of
 *      a cancellation.
 *
 * The SQL half reads the migration text rather than a live connection because
 * the repo suite has no database; the live behaviour was proven separately by
 * replaying this migration verbatim 3x in PGlite against a prod-shaped
 * schema (cancelled → closed, cancelled with NULL cancelled_at → closed via
 * updated_at, completed at +1h → still open, completed at +40h → closed,
 * in_progress → open, ACLs unchanged).
 *
 * @mutate supabase/migrations/20260919220233_close_cancelled_job_messaging.sql | COALESCE(j.cancelled_at, j.updated_at, j.created_at) | j.cancelled_at
 * @mutate supabase/migrations/20260919220233_close_cancelled_job_messaging.sql | AND j.status IN ('completed', 'cancelled') | AND j.status = 'completed'
 * @mutate src/lib/messagingLockout.ts | jobStatus === "cancelled"\n    ? { notice: THREAD_CANCELLED_NOTICE, toast: THREAD_CANCELLED_TOAST }\n    : | false\n    ? { notice: THREAD_CANCELLED_NOTICE, toast: THREAD_CANCELLED_TOAST }\n    :
 * @mutate src/components/messages/chatView/ChatComposer.tsx | {draft.trim().length > 0 && ( | {false && (
 */
import { describe, expect, it, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(), hapticHeavy: vi.fn(),
}));

import { ChatComposer } from "@/components/messages/chatView/ChatComposer";
import type { Conversation } from "@/components/messages/types";
import {
  threadClosedCopy,
  THREAD_CANCELLED_NOTICE,
  THREAD_CLOSED_NOTICE,
} from "@/lib/messagingLockout";

const MIGRATION = resolve(
  __dirname,
  "../../supabase/migrations/20260919220233_close_cancelled_job_messaging.sql",
);

/** The migration text with `--` comments stripped, so prose cannot satisfy a
 *  check that is supposed to be about SQL. */
function migrationSql(): string {
  return readFileSync(MIGRATION, "utf8").replace(/--[^\n]*/g, "");
}

describe("the migration: cancelled jobs get a closing instant in the past", () => {
  it("the inventory is real: the migration exists and replaces both functions", () => {
    // Without this the regexes below could all pass on an empty string.
    const sql = migrationSql();
    expect(sql.length).toBeGreaterThan(200);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.job_messaging_closes_at\(_job_id uuid\)/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.get_messaging_closes_at\(_job_ids uuid\[\]\)/);
  });

  it("the cancelled anchor cannot be NULL — the legacy-row trap is closed", () => {
    const sql = migrationSql();
    // `cancelled_at` is nullable. It must be wrapped in a COALESCE ending in
    // NOT NULL columns, or a legacy row keeps messaging open forever, which
    // is the exact bug being fixed surviving on old data.
    expect(sql).toMatch(
      /COALESCE\(\s*j\.cancelled_at\s*,\s*j\.updated_at\s*,\s*j\.created_at\s*\)/,
    );
    // And the bare column must not be the whole answer for the cancelled arm.
    expect(sql).not.toMatch(/WHEN 'cancelled' THEN\s*\n?\s*j\.cancelled_at\s*\n\s*ELSE/);
  });

  it("the CLIENT is told too — get_messaging_closes_at stops filtering to completed", () => {
    // Defect class 2: a gate the client cannot see becomes fail-on-tap.
    const sql = migrationSql();
    expect(sql).toMatch(/AND j\.status IN \('completed', 'cancelled'\)/);
    expect(
      sql.includes("AND j.status = 'completed'"),
      "the completed-only filter must be gone from the RPC, or the composer never learns the thread is closed",
    ).toBe(false);
  });

  it("the completed 24h rule is NOT changed", () => {
    const sql = migrationSql();
    expect(sql).toMatch(/WHEN 'completed' THEN/);
    expect(sql).toMatch(/\+ interval '24 hours'/);
    expect(sql).toMatch(/public\.job_legacy_completed_at\(/);
  });

  it("replay-safe, and the REVOKEs are restated", () => {
    const sql = migrationSql();
    // Default privileges re-grant on DROP+CREATE, so: no DROP at all...
    expect(sql).not.toMatch(/\bDROP\s+FUNCTION\b/i);
    // ...and every REVOKE named by role, not just FROM PUBLIC (anon keeps an
    // explicit grant otherwise).
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.job_messaging_closes_at\(uuid\) FROM PUBLIC, anon, authenticated;/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.get_messaging_closes_at\(uuid\[\]\) FROM PUBLIC, anon;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_messaging_closes_at\(uuid\[\]\) TO authenticated, service_role;/);
  });
});

const CANCELLED_CONVO: Conversation = {
  otherUserId: "u2",
  otherUserName: "Perry P.",
  jobTitle: "Fix a leaking kitchen faucet",
  jobId: "job-1",
  jobStatus: "cancelled",
  lastMessage: "on my way",
  lastAt: new Date().toISOString(),
  unread: 0,
} as Conversation;

function renderClosedComposer(over: Partial<Conversation>, draft: string) {
  return render(
    <ChatComposer
      threadClosed
      composerLocked={false}
      chatLoadError={false}
      keyboardInset={0}
      activeConvo={{ ...CANCELLED_CONVO, ...over }}
      messages={[]}
      userId="user-1"
      draft={draft}
      setDraft={vi.fn()}
      sendMessage={vi.fn(async () => true)}
      broadcastTyping={vi.fn()}
    />,
  );
}

afterEach(cleanup);

describe("the closed cancelled thread: honest copy, and the draft is not eaten", () => {
  it("the two copies are genuinely different, and neither is empty", () => {
    // Inventory: a parameterised copy helper that returned the same string
    // for both would satisfy every render assertion below.
    expect(THREAD_CANCELLED_NOTICE.length).toBeGreaterThan(20);
    expect(THREAD_CLOSED_NOTICE.length).toBeGreaterThan(20);
    expect(THREAD_CANCELLED_NOTICE).not.toBe(THREAD_CLOSED_NOTICE);
    expect(threadClosedCopy("cancelled").notice).toBe(THREAD_CANCELLED_NOTICE);
    expect(threadClosedCopy("completed").notice).toBe(THREAD_CLOSED_NOTICE);
    // Unknown/stale status falls back to the completion wording — the only
    // other way a thread closes today.
    expect(threadClosedCopy(null).notice).toBe(THREAD_CLOSED_NOTICE);
  });

  it("a cancelled thread never tells the reader the job was completed", () => {
    renderClosedComposer({}, "");
    const notice = screen.getByRole("status");
    expect(notice.textContent).toBe(THREAD_CANCELLED_NOTICE);
    expect(
      /complet/i.test(notice.textContent ?? ""),
      "telling somebody whose job was cancelled that it was completed is the copy defect this guards",
    ).toBe(false);
    expect(notice.textContent).toMatch(/cancelled/i);
  });

  it("a completed thread still gets the 24h wording — the fallback is not broken", () => {
    renderClosedComposer({ jobStatus: "completed" }, "");
    expect(screen.getByRole("status").textContent).toBe(THREAD_CLOSED_NOTICE);
  });

  it("it is a NOTICE, not a composer that fails on tap", () => {
    const { container } = renderClosedComposer({}, "");
    expect(screen.queryByTestId("thread-closed-notice")).toBeTruthy();
    // No send affordance at all — not a disabled one to fight with.
    expect(container.querySelector("textarea")).toBeNull();
    expect(screen.queryByRole("button", { name: /send/i })).toBeNull();
  });

  it("a draft caught mid-sentence is shown, not silently swallowed", () => {
    // Cancelling is something a human does in the moment: the thread can
    // close under an open keyboard. The text lived in ChatView's state and
    // simply became unreachable, which is worse than losing it.
    renderClosedComposer({}, "Hey, are we still on for Saturday?");
    const kept = screen.getByTestId("thread-closed-unsent-draft");
    expect(kept.textContent).toMatch(/Hey, are we still on for Saturday\?/);
    expect(kept.textContent).toMatch(/Not sent/);
  });

  it("an empty draft gets no empty box", () => {
    renderClosedComposer({}, "   ");
    expect(screen.queryByTestId("thread-closed-unsent-draft")).toBeNull();
  });
});
