import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs script, no types
import { checkRows, parseTracker } from "../../scripts/check-visual-notes.mjs";

const md = (rows: string) => `# Notes\n\n## Tracker\n\n| VN | Issue | Size | Fixed | Confirmed |\n|---|---|---|---|---|\n${rows}\n\n## Next\n| VN-99 | ignored | small | [x] | [x] |\n`;

const FIX_TIME = Date.parse("2026-09-14T12:00:00Z");
const env = (over: Partial<{ reviews: unknown[]; files: string[]; commits: string[] }> = {}) => ({
  reviews: over.reviews ?? [{ screenshot: "after/vn-1.png", verdict: "ok", reviewedAt: "2026-09-14T13:00:00Z" }],
  fileExists: (p: string) => (over.files ?? ["after/vn-1.png"]).includes(p),
  commitTime: (sha: string) => ((over.commits ?? ["abc123"]).includes(sha) ? FIX_TIME : null),
});

const problemsFor = (row: string, e = env()) => checkRows(parseTracker(md(row)).rows, e);

describe("check-visual-notes", () => {
  it("parses only the Tracker section", () => {
    const { rows } = parseTracker(md("| VN-1 | Pill | small | [ ] | [ ] |"));
    expect(rows.map((r: { id: string }) => r.id)).toEqual(["VN-1"]);
  });

  it("accepts an unticked row and a fully evidenced row", () => {
    expect(problemsFor("| VN-1 | Pill | small | [ ] | [ ] |")).toEqual([]);
    expect(problemsFor("| VN-1 | Pill | small | [x] abc123 | [x] after/vn-1.png |")).toEqual([]);
  });

  it("fails Fixed with no commit or an unknown commit", () => {
    expect(problemsFor("| VN-1 | Pill | small | [x] | [ ] |")[0]).toMatch(/no commit/);
    expect(problemsFor("| VN-1 | Pill | small | [x] deadbeef | [ ] |")[0]).toMatch(/not a commit/);
  });

  it("fails Confirmed without Fixed", () => {
    expect(problemsFor("| VN-1 | Pill | small | [ ] | [x] after/vn-1.png |")).toContainEqual(expect.stringMatching(/Fixed is not/));
  });

  it("fails Confirmed when the screenshot is missing", () => {
    expect(problemsFor("| VN-1 | Pill | small | [x] abc123 | [x] after/nope.png |")[0]).toMatch(/not in the evidence folder/);
  });

  it("fails Confirmed with no ok review, a defect review, or a review older than the fix", () => {
    const row = "| VN-1 | Pill | small | [x] abc123 | [x] after/vn-1.png |";
    expect(problemsFor(row, env({ reviews: [] }))[0]).toMatch(/no "ok" review/);
    expect(problemsFor(row, env({ reviews: [{ screenshot: "after/vn-1.png", verdict: "defect", reviewedAt: "2026-09-14T13:00:00Z" }] }))[0]).toMatch(/no "ok" review/);
    expect(problemsFor(row, env({ reviews: [{ screenshot: "after/vn-1.png", verdict: "ok", reviewedAt: "2026-09-14T11:00:00Z" }] }))[0]).toMatch(/no "ok" review/);
  });

  it("fails malformed cells", () => {
    expect(problemsFor("| VN-1 | Pill | small | done | [ ] |")[0]).toMatch(/must be/);
  });
});
