/**
 * Q1058 (owner, 2026-10-07): a NEW nightly-red issue reaches Slack at once.
 *
 * Re-measured 2026-10-05: prod down, deploy failed, Stripe webhook failures
 * and DB limits all posted to SLACK_WEBHOOK_URL; a new nightly-red issue only
 * opened an issue and a ledger row (nightly-issue-sync opens/comments, the
 * ledger sync records, and the daily digest summarises error_logs only). The
 * owner picked the instant post: `ops-alert-ledger.mjs sync` posts every issue
 * it records for the FIRST time, in one message, from prod-errors.yml.
 *
 * @mutate scripts/lib/opsAlertLedger.mjs |   return (recorded ?? []).filter((i) => !known.has(String(i.number))); |   return recorded ?? [];
 * @mutate scripts/ops-alert-ledger.mjs |     const posted = await postSlackText(slackText); |     const posted = false;
 * @mutate .github/workflows/prod-errors.yml |           SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}\n        run: \|\n          if | run: \|\n          if
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";
// @ts-expect-error - plain .mjs tool script, no types
import * as lib from "../../scripts/lib/opsAlertLedger.mjs";

const issue = (number: number, title: string) => ({ number, title, url: `https://github.com/x/y/issues/${number}`, updatedAt: "2026-10-07T00:00:00Z" });

describe("Q1058: a nightly-red issue recorded for the first time is posted to Slack", () => {
  it("only issues with no ledger row yet are new", () => {
    const known = new Map([["2244", new Date("2026-10-06T00:00:00Z")]]);
    const recorded = [issue(2244, "nightly-red: nightly-red-age"), issue(2600, "nightly-red: vacuity")];
    expect(lib.firstSeenNightlyIssues(known, recorded).map((i: { number: number }) => i.number)).toEqual([2600]);
    expect(lib.firstSeenNightlyIssues(known, [])).toEqual([]);
  });

  it("one message lists every new issue with its link; none -> no message", () => {
    const text = lib.newNightlyRedSlackText([issue(2600, "nightly-red: vacuity"), issue(2601, "nightly-red: slow-network")]);
    expect(text).toContain("nightly-red: vacuity — https://github.com/x/y/issues/2600");
    expect(text).toContain("nightly-red: slow-network — https://github.com/x/y/issues/2601");
    expect(lib.newNightlyRedSlackText([])).toBeNull();
  });

  it("posts to SLACK_WEBHOOK_URL; a missing secret or a refusal warns and never throws", async () => {
    const ok = vi.fn(async () => new Response("ok", { status: 200 }));
    expect(await lib.postSlackText("hi", { url: "https://hooks.example/x", fetchImpl: ok })).toBe(true);
    expect(JSON.parse((ok.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toEqual({ text: "hi" });

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await lib.postSlackText("hi", { url: "", fetchImpl: ok })).toBe(false);
      const refused = vi.fn(async () => new Response("no", { status: 403 }));
      expect(await lib.postSlackText("hi", { url: "https://hooks.example/x", fetchImpl: refused })).toBe(false);
      const down = vi.fn(async () => { throw new Error("ECONNRESET"); });
      expect(await lib.postSlackText("hi", { url: "https://hooks.example/x", fetchImpl: down })).toBe(false);
      expect(log.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("::warning::"))).toHaveLength(3);
    } finally {
      log.mockRestore();
    }
  });

  it("sync wires it: the issues it records are collected, the new ones posted", () => {
    const src = blankComments(readFileSync("scripts/ops-alert-ledger.mjs", "utf8"));
    expect(src).toMatch(/recordedNow\.push\(i\)/);
    expect(src).toMatch(/firstSeenNightlyIssues\(known, recordedNow\)/);
    expect(src).toMatch(/await postSlackText\(slackText\)/);
  });

  it("prod-errors.yml hands the sync step the webhook", () => {
    const yml = readFileSync(".github/workflows/prod-errors.yml", "utf8");
    const step = yml.slice(yml.indexOf("- name: Sync, verify, list"), yml.indexOf("node scripts/ops-alert-ledger.mjs list"));
    expect(step).toContain("SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}");
    expect(step).toContain("node scripts/ops-alert-ledger.mjs sync");
  });
});
