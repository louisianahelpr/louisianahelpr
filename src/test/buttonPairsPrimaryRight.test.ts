/**
 * Owner 11-01 (via the lead, app-wide): in every side-by-side pair of buttons the green primary sits on the RIGHT, and
 * both read on ONE line. Inventory: every row of exactly two <Button>s in src/ (src/test/helpers/buttonPairs.ts, the
 * TypeScript parser). On 2026-11-01 the scan found 69 pairs, 33 with the primary on the left (all swapped by B111) and
 * none that may wrap (Button's base class is whitespace-nowrap; size "wrap" or whitespace-normal would break it).
 *
 * @mutate src/components/admin/settings/CategorySuggestionsCard.tsx | <Button variant="outline" onClick={() => decide.mutate(false)} disabled={decide.isPending}>Decline</Button>\n        <Button onClick={() => decide.mutate(true)} | <Button onClick={() => decide.mutate(false)} disabled={decide.isPending}>Decline</Button>\n        <Button variant="outline" onClick={() => decide.mutate(true)}
 * @mutate src/components/jobs/InstantBookingCard.tsx |           <Button variant="outline" className="flex-1 rounded-full" disabled={busy !== null} onClick={() => setConfirmDecline(true)}> |           <Button variant="outline" size="wrap" className="flex-1 rounded-full" disabled={busy !== null} onClick={() => setConfirmDecline(true)}>
 * @mutate src/test/helpers/buttonPairs.ts | export const isPrimary = (s: ButtonPairSide) => s.variant === "primary" \|\| s.variant === "default"; | export const isPrimary = (s: ButtonPairSide) => s.variant === "primary";
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { buttonPairsIn, isPrimary, mayWrap } from "./helpers/buttonPairs";

const files = execFileSync("git", ["ls-files", "src/**/*.tsx"], { encoding: "utf8" })
  .split("\n")
  .filter((f) => f && !/\.test\.tsx$/.test(f) && !f.startsWith("src/test/"));
const pairs = files.flatMap((f) => buttonPairsIn(f, readFileSync(f, "utf8")));
const where = (p: (typeof pairs)[number]) => `${p.file}:${p.line} [${p.left.text.slice(0, 30)} | ${p.right.text.slice(0, 30)}]`;

describe("every side-by-side button pair: one line, the green primary on the right", () => {
  it("reads the app's pairs (floor)", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(pairs.length).toBeGreaterThan(60);
    expect(pairs.filter((p) => isPrimary(p.right)).length).toBeGreaterThan(30);
  });

  it("the primary is never on the left of a pair whose other button is not primary", () => {
    expect(pairs.filter((p) => isPrimary(p.left) && !isPrimary(p.right)).map(where)).toEqual([]);
  });

  it("no button in a pair may wrap its words onto a second line", () => {
    expect(pairs.filter((p) => mayWrap(p.left) || mayWrap(p.right)).map(where)).toEqual([]);
  });

  it("the scanner itself sees a primary-left pair and a wrapping one (synthetic)", () => {
    const bad = buttonPairsIn("x.tsx", `const A = () => <div className="flex gap-2"><Button>Save</Button><Button variant="outline" size="wrap">Cancel</Button></div>;`);
    expect(bad).toHaveLength(1);
    expect(isPrimary(bad[0].left) && !isPrimary(bad[0].right)).toBe(true);
    expect(mayWrap(bad[0].right)).toBe(true);
    expect(buttonPairsIn("y.tsx", `const B = () => <div className="flex flex-col gap-2"><Button>Save</Button><Button variant="outline">Cancel</Button></div>;`)).toHaveLength(0);
  });
});
