import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { posterDisputeControls } from "./posterDisputeControls";

/**
 * THE POSTER'S DISPUTE CARD MAY NOT NAME AN ACTION IT DOES NOT OFFER.
 *
 * External QA, 2026-09-06. The card told the poster, verbatim: "Confirm the
 * issue is fixed or escalate to admin. If no action is taken, payment
 * auto-releases to the Helpr." Every `<button>` on that card was then
 * enumerated. The complete list was: Timeline & Evidence, Message, Contact
 * Admin. The party holding the money was told to take one of two actions and
 * neither existed; the only real path was to wait out a 72-hour clock that
 * ends by paying the other side.
 *
 * It happened because the sentence and the chips were computed in different
 * places — the chips behind `isDisputer && dispute_status === "open"` in the
 * JSX, the sentence with no gate at all — so no amount of reading either one
 * could show the mismatch. Production job 8133a907-f36f-4278-96c4-41d4ce1d56c8
 * was in both of the states that produce it at once: `disputed_by` = the
 * helper, `dispute_status` = 'helper_responded'.
 *
 * WHAT MAKES THIS TEST NON-VACUOUS. It does not compare the copy against a
 * hand-written list of expected strings — a list like that is written by the
 * same person who wrote the copy, so it agrees with whatever shipped. It walks
 * the WHOLE state space (`disputed_by` x every `dispute_status` value the app
 * writes) and asserts a relation between two things the module returns
 * independently: if a sentence names an action, the flag that renders that
 * action's control must be true in the SAME result. That relation is what was
 * false before the fix, in 2 of the 12 states below, and it cannot be satisfied
 * by editing the copy alone.
 */

const POSTER = "poster-uuid";
const HELPER = "helper-uuid";

/**
 * Every value that reaches `jobs.dispute_status`, gathered from the writers
 * rather than invented here:
 *   'open'              rpc_open_dispute (live definition, prod 2026-09-06)
 *   'helper_responded'  DisputedSection's response submit
 *   'escalated'         PostedJobActions' Escalate chip
 *   'resolved'          rpc_withdraw_dispute
 *   'auto_resolved'     auto-resolve-disputes
 *   null                a dispute filed before the column existed
 */
const DISPUTE_STATUSES = [
  null,
  "open",
  "helper_responded",
  "escalated",
  "resolved",
  "auto_resolved",
] as const;

/**
 * The phrases that PROMISE a control, paired with the flag that renders it.
 *
 * Matchers are deliberately loose (`/escalat/i`) — a rewrite of the sentence
 * must keep satisfying this, not slip out of it on a synonym. The pairing is
 * the assertion; the wording is not pinned.
 */
const PROMISES: Array<{
  label: string;
  matcher: RegExp;
  flag: (c: ReturnType<typeof posterDisputeControls>) => boolean;
}> = [
  {
    label: "escalate to an admin",
    matcher: /escalat/i,
    flag: (c) => c.canEscalate,
  },
  {
    label: "resolve the dispute / release the payment yourself",
    // "Resolve & Pay" (the chip's own name) or "Resolve this and release".
    matcher: /resolve (?:&|this)/i,
    flag: (c) => c.canResolve,
  },
];

describe("poster dispute card — copy may not promise a control it doesn't render", () => {
  const states = DISPUTE_STATUSES.flatMap((dispute_status) =>
    [POSTER, HELPER].map((disputed_by) => ({
      dispute_status,
      disputed_by,
      dispute_deadline: "2026-09-10T02:00:29.384Z",
    })),
  );

  it("covers the whole state space, not a sample", () => {
    // Guards the guard: if a `dispute_status` value is dropped from the list
    // above, the loops below quietly stop testing that state and go green.
    expect(states.length).toBe(DISPUTE_STATUSES.length * 2);
    // And both sides of `disputed_by` really do produce different results —
    // otherwise the second half of every pair is dead weight and this file
    // would be testing one axis while claiming two.
    const posterFiled = posterDisputeControls({ disputed_by: POSTER, dispute_status: "open" }, POSTER);
    const helperFiled = posterDisputeControls({ disputed_by: HELPER, dispute_status: "open" }, POSTER);
    expect(posterFiled.canResolve).not.toBe(helperFiled.canResolve);
    expect(posterFiled.consequenceText).not.toBe(helperFiled.consequenceText);
  });

  it("every promise in the countdown caption is backed by a rendered control", () => {
    for (const job of states) {
      const c = posterDisputeControls(job, POSTER);
      for (const p of PROMISES) {
        if (!p.matcher.test(c.consequenceText)) continue;
        expect(
          p.flag(c),
          `dispute_status=${job.dispute_status} disputed_by=${job.disputed_by === POSTER ? "poster" : "helper"}: ` +
            `the caption offers "${p.label}" but the control is not rendered.\n  caption: ${c.consequenceText}`,
        ).toBe(true);
      }
    }
  });

  it("every promise in the static policy paragraph is backed by a rendered control", () => {
    for (const job of states) {
      // The policy paragraph is the no-live-deadline fallback, so evaluate it
      // in the shape that actually shows it.
      const c = posterDisputeControls({ ...job, dispute_deadline: null }, POSTER);
      for (const p of PROMISES) {
        if (!p.matcher.test(c.policyText)) continue;
        expect(
          p.flag(c),
          `dispute_status=${job.dispute_status} disputed_by=${job.disputed_by === POSTER ? "poster" : "helper"}: ` +
            `the policy paragraph offers "${p.label}" but the control is not rendered.\n  policy: ${c.policyText}`,
        ).toBe(true);
      }
    }
  });

  it("always says what happens if the poster does nothing", () => {
    // The half of the original sentence that was TRUE, and the half a poster
    // most needs. Rewriting the promises must not lose it.
    for (const job of states) {
      const c = posterDisputeControls(job, POSTER);
      expect(
        /auto-releases|on hold/i.test(c.consequenceText),
        `dispute_status=${job.dispute_status}: the caption stopped saying what happens by default.\n  ${c.consequenceText}`,
      ).toBe(true);
    }
  });

  describe("the two states QA actually hit", () => {
    it("the helper filed — the poster can still escalate, and is told only that", () => {
      // Reproduced from production job 8133a907: disputed_by = helper_id.
      // Before the fix this poster had NO control and was told to use two.
      const c = posterDisputeControls(
        { disputed_by: HELPER, dispute_status: "open", dispute_deadline: "2026-09-10T00:00:00Z" },
        POSTER,
      );
      expect(c.canEscalate).toBe(true);
      expect(c.canResolve).toBe(false);
      expect(c.consequenceText).toMatch(/escalat/i);
      // The specific lie: it must not tell a non-opener to confirm/resolve.
      expect(c.consequenceText).not.toMatch(/resolve (?:&|this)/i);
    });

    it("the poster filed and the helper replied — both controls survive", () => {
      // `dispute_status` moves to 'helper_responded', which is not 'open', and
      // that alone used to remove Resolve & Pay AND Escalate from the opener's
      // own card. rpc_withdraw_dispute keys off `disputes.status`, which is
      // still 'open' here, so the control was removed for no server reason.
      const c = posterDisputeControls(
        { disputed_by: POSTER, dispute_status: "helper_responded", dispute_deadline: "2026-09-10T00:00:00Z" },
        POSTER,
      );
      expect(c.canResolve).toBe(true);
      expect(c.canEscalate).toBe(true);
    });
  });

  it("an escalated dispute offers nothing and promises nothing", () => {
    // auto-resolve-disputes SKIPS escalated disputes, so no deadline will fire
    // and a countdown here would be a promise nothing keeps.
    const c = posterDisputeControls(
      { disputed_by: POSTER, dispute_status: "escalated", dispute_deadline: "2026-09-10T00:00:00Z" },
      POSTER,
    );
    expect(c.awaitingAdmin).toBe(true);
    expect(c.showDeadline).toBe(false);
    expect(c.canResolve).toBe(false);
    expect(c.canEscalate).toBe(false);
  });
});

/**
 * THE SERVER HALF: Resolve & Pay is only offered to the party the database
 * will let do it.
 *
 * `rpc_withdraw_dispute` raises "only the party who opened this dispute may
 * withdraw it" for anyone else. Offering the chip to a non-opener would move
 * the QA finding one layer down — a button that exists and always fails —
 * which is worse than a button that is absent, because it costs a round trip
 * and an error toast on a screen about someone's money.
 *
 * Read out of the newest migration that defines the function rather than
 * retyped, by the same rule jobsGuardRpcParity.test.ts uses: a hardcoded path
 * is how a parity test goes quietly blind.
 */
describe("Resolve & Pay ↔ rpc_withdraw_dispute's opener check", () => {
  const MIGRATIONS = resolve(__dirname, "../../../../supabase/migrations");

  function liveDefinition(fnName: string): string {
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
    const defining = files.filter((f) =>
      readFileSync(resolve(MIGRATIONS, f), "utf8").includes(`FUNCTION public.${fnName}`),
    );
    expect(
      defining.length,
      `No migration defines public.${fnName}. If it was renamed, re-point this test — do not delete the check.`,
    ).toBeGreaterThan(0);
    return readFileSync(resolve(MIGRATIONS, defining[defining.length - 1]), "utf8");
  }

  it("the RPC still refuses a non-opener, so the chip must still be opener-only", () => {
    const sql = liveDefinition("rpc_withdraw_dispute");
    const refusesNonOpener = /_opener\s+IS DISTINCT FROM\s+_uid/i.test(sql);
    expect(
      refusesNonOpener,
      "rpc_withdraw_dispute no longer refuses a non-opener. If either party may now " +
        "withdraw, `canResolve` in posterDisputeControls.ts can drop its `isDisputer` " +
        "term — but make that change deliberately, and re-check the copy branches with it.",
    ).toBe(true);

    // And the client agrees: a poster who did not open it is never offered it.
    for (const status of ["open", "helper_responded"]) {
      expect(
        posterDisputeControls({ disputed_by: HELPER, dispute_status: status }, POSTER).canResolve,
        `Resolve & Pay is offered on a helper-filed dispute (${status}); the RPC will refuse it.`,
      ).toBe(false);
    }
  });
});
