/**
 * Q1313 (owner, 2026-10-06): the one-time launch push. The copy is exactly the
 * owner-approved text, it reaches only people with a device token whose job
 * pushes are on, and nobody who already has it gets it twice.
 *
 * @mutate scripts/launch-go.mjs |   body: "Work is landing on Helpr. Paid jobs are open now. Tap to browse.", |   body: "Paid jobs are open.",
 * @mutate scripts/launch-go.mjs | p.push_enabled === false || p.job_matches === false | p.push_enabled === false
 * @mutate scripts/launch-go.mjs | !off.has(u) && !sent.has(u) | !off.has(u)
 * @mutate scripts/launch-go.mjs |   if (pushFlag) ok = (await launchPush(confirm && ok)) && ok; |   if (pushFlag) ok = (await launchPush(true)) && ok;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const SRC = readFileSync("scripts/launch-go.mjs", "utf8");

// The script runs main() on import, so the pure parts are checked from source.
function recipients(tokens: { user_id: string }[], prefs: { user_id: string; push_enabled?: boolean; job_matches?: boolean }[], sent: string[]) {
  const body = /export function launchPushRecipients\(tokens, prefs, alreadySent\) \{([\s\S]*?)\n\}/.exec(SRC)![1];
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function("tokens", "prefs", "alreadySent", body)(tokens, prefs, sent) as string[];
}

describe("the launch push (Q1313)", () => {
  it("uses the owner's exact copy", () => {
    expect(SRC).toContain('body: "Work is landing on Helpr. Paid jobs are open now. Tap to browse.",');
  });
  it("reaches token holders with job pushes on, once each, never twice", () => {
    const tokens = [{ user_id: "a" }, { user_id: "a" }, { user_id: "b" }, { user_id: "c" }, { user_id: "d" }];
    const prefs = [{ user_id: "b", push_enabled: false }, { user_id: "c", job_matches: false }];
    expect(recipients(tokens, prefs, ["d"]).sort()).toEqual(["a"]);
  });
  it("sends only with --confirm AND every precondition passed", () => {
    expect(SRC).toContain("if (pushFlag) ok = (await launchPush(confirm && ok)) && ok;");
  });
});
