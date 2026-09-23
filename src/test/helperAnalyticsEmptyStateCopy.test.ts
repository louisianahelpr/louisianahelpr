/*
 * Q246 — the "Nothing to measure yet" empty state on Advanced Analytics
 * (a Profile tab every account sees, per CLAUDE.md "every feature shows to
 * everyone") told the reader to "Apply for a job and finish one" with nothing
 * saying this works the same for an account that mostly posts jobs. It never
 * named a banned role word (roleNeutralCopy.test.ts's ROLE_NOUN/IDENTITY
 * patterns don't fire on it), so that guard passed while the copy still read
 * as addressed to one persona.
 *
 * This pins the fix: both empty-state bodies must say up front that any
 * account can unlock this panel, not just one that already thinks of itself
 * as "a Helpr".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FILE = resolve(__dirname, "../pages/HelperAnalytics.tsx");

function emptyStateBodies(source: string): string[] {
  const bodies: string[] = [];
  for (const m of source.matchAll(/"((?:[^"\\]|\\.)*Apply for a job and finish one[^"]*|(?:[^"\\]|\\.)*Any account can do this[^"]*)"/g)) {
    bodies.push(m[1]);
  }
  return bodies;
}

describe("HelperAnalytics empty state does not address only the job-doing side (Q246)", () => {
  it("fixture: flags copy that only tells the job-doing side how to unlock the page", () => {
    const source = `body={cond ? "Apply for a job and finish one, and this page starts answering." : "x"}`;
    const bodies = emptyStateBodies(source);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toMatch(/any account/i);
  });

  it("the real source's empty-state bodies say up front that any account can unlock this", () => {
    const source = readFileSync(FILE, "utf8");
    const bodies = emptyStateBodies(source);
    expect(bodies.length).toBeGreaterThanOrEqual(2);
    for (const body of bodies) {
      expect(body, body).toMatch(/^any account can do this/i);
    }
  });
});
