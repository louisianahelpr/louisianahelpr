/**
 * Audit 11-10 W2 F279: the disputed job's More-options chips read "Escalate", "Timeline & Evidence" and
 * "Contact admin" — internal words a worried poster cannot pick between. They now say what happens in plain
 * words on BOTH sides of the dispute (poster card and Helpr card), and the escalate confirm dialog no longer
 * says "admin".
 *
 * @mutate src/pages/posts/postedJobCard/steps/DisputedStep.tsx | label="Ask support to decide" | label="Escalate"
 * @mutate src/pages/jobs/appliedJobCard/DisputedSection.tsx | label="Helpr support" | label="Contact admin"
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const SIDES = {
  poster: "src/pages/posts/postedJobCard/steps/DisputedStep.tsx",
  helper: "src/pages/jobs/appliedJobCard/DisputedSection.tsx",
} as const;

const JARGON = ['label="Escalate"', 'label="Timeline & Evidence"', 'label="Contact admin"', 'primaryLabel="Escalate to Admin"'];

function labels(src: string): string[] {
  return [...src.matchAll(/\blabel="([^"]+)"/g)].map((m) => m[1]);
}

describe("F279: dispute chips speak plain words on both sides", () => {
  for (const [side, file] of Object.entries(SIDES)) {
    const src = blankComments(readFileSync(file, "utf8"));
    it(`${side}: no internal word is a chip label`, () => {
      for (const j of JARGON) expect(src, `${file} still carries ${j}`).not.toContain(j);
      expect(labels(src).length).toBeGreaterThan(2);
    });
    it(`${side}: the plain labels are present`, () => {
      const got = labels(src);
      expect(got).toContain("Helpr support");
      expect(got).toContain("What's been sent");
    });
  }
  it("poster: the escalate chip and its confirm dialog say who decides", () => {
    const src = blankComments(readFileSync(SIDES.poster, "utf8"));
    expect(labels(src)).toContain("Ask support to decide");
    expect(src).toContain('title="Ask Helpr support to decide?"');
    for (const old of ["Escalated to an admin", "Send this to an admin?", "An admin is reviewing", "A Helpr admin will"]) {
      expect(src, `the poster still reads "${old}"`).not.toContain(old);
    }
  });
});
