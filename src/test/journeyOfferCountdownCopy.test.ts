/**
 * The journey reads the offer's countdown in the app's own words.
 *
 * 02-marketplace's time-travel step waited 45s for "1m remaining" on the
 * Helpr's offer card while the card plainly read "1m left to answer"
 * (e2e-journeys 38527058685, test-failed-3.png): the owner's one-format
 * countdown (2026-10-07, Q1399) moved the offer to CountdownRows with the
 * suffix "left to answer"; "remaining" is DeadlineCountdown's word for the
 * review window, which the journey still (correctly) reads further down.
 *
 * So the expectation is tied to the source: the suffix the journey expects on
 * the offer is the suffix OfferedActions' answer clock renders.
 *
 * @mutate e2e/journeys/02-marketplace.spec.ts | c.getByText("1m left to answer") | c.getByText("1m remaining")
 * @mutate src/pages/jobs/appliedJobCard/OfferedActions.tsx | { id: "answer", at: deadline, text: "left to answer" | { id: "answer", at: deadline, text: "to answer"
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => blankComments(readFileSync(join(ROOT, p), "utf8"));

describe("02-marketplace reads the offer countdown the app renders", () => {
  const app = read("src/pages/jobs/appliedJobCard/OfferedActions.tsx");
  const spec = read("e2e/journeys/02-marketplace.spec.ts");

  it("finds the answer clock's suffix in OfferedActions", () => {
    expect(app).toMatch(/\{ id: "answer", at: deadline, text: "[^"]+"/);
  });

  it("the offer step expects exactly that suffix", () => {
    const suffix = /\{ id: "answer", at: deadline, text: "([^"]+)"/.exec(app)![1];
    const step = spec.slice(spec.indexOf("time travel: the offer counts down to its deadline"), spec.indexOf("time travel: the offer counts down to its deadline") + 1500);
    expect(step.length).toBeGreaterThan(500);
    const expected = [...step.matchAll(/getByText\("1m ([^"]+)"\)/g)].map((m) => m[1]);
    expect(expected.length, "the offer step no longer reads a 1-minute countdown").toBeGreaterThan(0);
    for (const e of expected) expect(e).toBe(suffix);
  });
});
