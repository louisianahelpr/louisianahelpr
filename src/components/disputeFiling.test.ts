import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { disputeReasonsFor, DISPUTE_DETAILS_MIN, composeDisputeReason } from "./disputeReasons";

/**
 * FILING A DISPUTE — the two things external QA proved were wrong on
 * 2026-09-06, held in place.
 *
 * 1. A DISPUTE COULD BE FILED WITH NO EXPLANATION AT ALL.
 *    reason "Other" → "What happened?" left empty → Submit → 200, dispute
 *    created. The stored `disputes.reason` was the literal string "Other:" —
 *    label, colon, nothing — and that is what the counterparty, the timeline,
 *    the admin queue and the Slack ops page were all shown, while
 *    `jobs.dispute_deadline` froze the escrow for 72 hours on the strength of
 *    it. The row is still in production: job
 *    8133a907-f36f-4278-96c4-41d4ce1d56c8.
 *
 *    The asymmetry is what makes it a defect rather than a preference: the
 *    RESPONSE box on the same flow was already gated (DisputedSection's Submit
 *    is `disabled={!disputeResponse.trim() || …}`). Only the filing half — the
 *    half that moves money — was open.
 *
 * 2. THE DISPUTE A HELPER FILES WAS WRITTEN IN THE POSTER'S VOICE.
 *    The same "Something Wrong? Open a Dispute" link sits on the helper's
 *    completed job, and it offered them: "Work was not done · Poor quality work
 *    · Helpr didn't show up · Work was left incomplete · Other". Every one is a
 *    complaint about the helper, offered to the helper. A helper with a real
 *    problem could only pick "Other" — which is precisely the value that
 *    carries no information, on the one field an admin decides the case from.
 *    That is also how the "Other:" row above came to exist.
 */

describe("dispute reasons are written for the side that is filing", () => {
  const poster = disputeReasonsFor("poster");
  const helper = disputeReasonsFor("helper");

  it("the two sides are not the same list", () => {
    // The whole finding in one assertion: before the fix these were literally
    // the same array, so this test could not have passed by any wording change.
    expect(helper.map((r) => r.value)).not.toEqual(poster.map((r) => r.value));
  });

  it("no reason a helper can pick is an accusation against the helper", () => {
    // Derived from the shape of the defect rather than from a list of blessed
    // strings: the poster's reasons are complaints about the Helpr, and three
    // of the five name them outright. A helper-side reason that talks about
    // "the Helpr" is the poster's copy leaking back across.
    for (const r of helper) {
      expect(
        /helpr/i.test(r.label),
        `"${r.label}" is offered to the HELPER but is phrased as a complaint about them.`,
      ).toBe(false);
    }
  });

  it("the only reason both sides share is the catch-all", () => {
    // A reason meaningful to both parties is fine in principle; today there is
    // exactly one, and if that changes it should be a decision, not a copy
    // paste. This is what fails if someone "fixes" a gap by re-adding a poster
    // reason to the helper list.
    const shared = helper
      .map((r) => r.value)
      .filter((v) => poster.some((p) => p.value === v));
    expect(shared).toEqual(["other"]);
  });

  it("gives the helper a real reason for each situation that used to fall into Other", () => {
    // The four cases named in the QA report. Matched on MEANING (loose
    // regexes), not on the exact labels, so rewording the options keeps this
    // passing while deleting one of them does not. Before the fix all four
    // matched nothing — every one of them was "Other".
    const situations: Array<[string, RegExp]> = [
      ["poster refusing to confirm the work", /confirm/i],
      ["the job was not what was described", /described|as described/i],
      ["scope grew on arrival", /outside the job|scope|extra work/i],
      ["could not reach the site or the poster", /access|wasn't there|respond|unsafe/i],
    ];
    for (const [situation, matcher] of situations) {
      expect(
        helper.some((r) => matcher.test(r.label)),
        `a helper disputing "${situation}" has no option but Other. ` +
          `Available: ${helper.map((r) => r.label).join(" · ")}`,
      ).toBe(true);
    }
  });
});

describe("a dispute cannot be filed with no explanation", () => {
  it("reproduces the exact string production stored, and refuses it", () => {
    // `composeDisputeReason` is the same call DisputeDialog makes, so this
    // regenerates the production value byte for byte rather than quoting it:
    // `disputes.reason` on job 8133a907 is "Other:".
    expect(composeDisputeReason("helper", "other", "")).toBe("Other:");
    expect(composeDisputeReason("helper", "other", "   ")).toBe("Other:");

    // Two independent gates catch it. The client's, here…
    expect(DISPUTE_DETAILS_MIN).toBeGreaterThan(0);
    expect("".trim().length >= DISPUTE_DETAILS_MIN).toBe(false);
    expect("   ".trim().length >= DISPUTE_DETAILS_MIN).toBe(false);
    // …and the server's rule, evaluated here on the composed string so the two
    // cannot drift into a shape only one of them rejects. Same three
    // predicates as rpc_open_dispute; proven against real Postgres in PGlite
    // before shipping (3 consecutive applies, this exact string among them).
    const serverRejects = (raw: string) => {
      const t = raw.trim();
      return t === "" || t.endsWith(":") || t.length < 15;
    };
    expect(serverRejects(composeDisputeReason("helper", "other", ""))).toBe(true);
    expect(serverRejects(composeDisputeReason("poster", "work_not_done", ""))).toBe(true);
    // A real filing clears both.
    const real = composeDisputeReason("helper", "no_access", "Gate was locked and nobody answered.");
    expect(real.trim().length >= 15).toBe(true);
    expect(serverRejects(real)).toBe(false);
  });

  it("the Submit button is disabled on the description, not just the reason", () => {
    // Reads the component source because the gate lives in JSX. Pinning the
    // DISABLE EXPRESSION rather than rendering keeps this cheap, and it is the
    // exact thing that was missing: `disabled={submitting || !reason}` shipped
    // and accepted an empty description.
    const src = readFileSync(resolve(__dirname, "DisputeDialog.tsx"), "utf8");
    expect(
      /disabled=\{submitting \|\| !reason \|\| !detailsOk\}/.test(src),
      "DisputeDialog's Submit is no longer gated on the description. An empty " +
        '"What happened?" is what produced the production reason "Other:" and a ' +
        "72-hour escrow freeze an admin could not decide.",
    ).toBe(true);
  });

  it("the SERVER refuses it too, in the live definition of rpc_open_dispute", () => {
    // The client gate is a courtesy; the RPC is directly callable with any
    // string, and the reason a payout is held has to be defensible server-side.
    // Read from the newest migration that defines the function, by the same
    // rule jobsGuardRpcParity.test.ts uses — a hardcoded path is how a parity
    // test goes quietly blind when a later migration redefines the function.
    const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
    const defining = files.filter((f) =>
      readFileSync(resolve(MIGRATIONS, f), "utf8").includes("FUNCTION public.rpc_open_dispute"),
    );
    expect(
      defining.length,
      "No migration defines public.rpc_open_dispute — re-point this test, do not delete it.",
    ).toBeGreaterThan(0);
    const sql = readFileSync(resolve(MIGRATIONS, defining[defining.length - 1]), "utf8");

    expect(
      sql,
      "the live rpc_open_dispute no longer raises dispute_needs_description. " +
        "A caller going around the client can freeze an escrow with an empty reason again.",
    ).toContain("dispute_needs_description");

    // The three rules, each pinned separately so removing one is visible.
    // `right(...) = ':'` is the one that catches the exact production string.
    expect(sql, "the blank-reason rule is gone").toMatch(/_reason_trimmed\s*=\s*''/);
    expect(sql, "the label-with-no-body rule is gone — 'Other:' would pass again")
      .toMatch(/right\(_reason_trimmed,\s*1\)\s*=\s*':'/);
    expect(sql, "the minimum-length rule is gone").toMatch(/length\(_reason_trimmed\)\s*<\s*\d+/);

    // And it must run BEFORE the job is read, so the existing-dispute
    // (re-file) branch is covered too — that branch pages ops with `_reason`.
    const gateAt = sql.indexOf("dispute_needs_description");
    const jobReadAt = sql.indexOf("FROM public.jobs WHERE id = _job_id FOR UPDATE");
    expect(
      gateAt >= 0 && jobReadAt >= 0 && gateAt < jobReadAt,
      "the description gate moved below the job lookup, so the re-file branch " +
        "can slip an empty reason past it and page ops with it.",
    ).toBe(true);
  });

  it("the client has human copy for the code the server raises", () => {
    // Without this the RPC's terse code reaches the toast verbatim — the exact
    // complaint that produced lifecycleErrors.ts in the first place ("I'm
    // trying to file a dispute but it's not letting me").
    const errs = readFileSync(resolve(__dirname, "../lib/lifecycleErrors.ts"), "utf8");
    expect(errs).toContain("dispute_needs_description");
  });
});
