/**
 * Status pills read in sentence case, never ALL CAPS (Q2001, owner order
 * 2026-10-17 "Add all 12", S9: "ALL-CAPS status pills ("IN PROGRESS") ...
 * Sentence case, fewer colours").
 *
 * The messages list row chip was already sentence case (audit #53), but the
 * open thread's header painted the SAME job status in `uppercase` with
 * letter-spacing, so one thread read "In progress" in the list and
 * "IN PROGRESS" once opened. The account pills that state a status ("On",
 * "This device", a warning's action) had the same tiny-caps recipe.
 *
 * Each entry names the file and the code that renders the pill's label; the
 * guard reads the `<span` that opens the pill (the last one before the label)
 * and refuses `uppercase`, `tracking-wider` and an inline `letterSpacing`.
 * Not covered on purpose (labels, not statuses): plan/tier badges, platform
 * names, review categories, "Most popular", section headers.
 *
 * @mutate src/components/messages/ChatHeader.tsx | className="text-ds-11 font-sans font-semibold px-1.5 py-0.5 rounded-full shrink-0 ml-auto" | className="text-ds-9 font-sans font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0 ml-auto"
 * @mutate src/components/profile/TwoFactorCard.tsx | className="shrink-0 text-ds-11 font-semibold px-2 py-0.5 rounded-full" | className="shrink-0 text-ds-10 font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
 * @mutate src/components/profile/SecurityTab.tsx | className="text-ds-11 font-semibold px-1.5 py-0.5 rounded-full" | className="text-ds-10 font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
 * @mutate src/components/profile/WarningsTab.tsx | rounded-full text-ds-11 font-semibold shrink-0 | rounded-full text-ds-10 font-bold uppercase tracking-wider shrink-0
 * @mutate src/components/profile/WarningsTab.tsx | {actionLabel(v.action_taken)} | {v.action_taken.replace(/_/g, " ")}
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const PILLS: { file: string; label: string; what: string }[] = [
  { file: "src/components/messages/ChatHeader.tsx", label: "{label}", what: "thread header job status" },
  { file: "src/components/messages/ConversationRow.tsx", label: "{statusChip.label}", what: "messages row job status" },
  { file: "src/components/profile/TwoFactorCard.tsx", label: "On\n", what: "two-step sign-in On" },
  { file: "src/components/profile/SecurityTab.tsx", label: "This device\n", what: "this device" },
  { file: "src/components/profile/WarningsTab.tsx", label: "{actionLabel(v.action_taken)}", what: "warning action" },
];

function pillOpening(file: string, label: string): string {
  const src = blankComments(readFileSync(file, "utf8"));
  const at = src.indexOf(label);
  expect(at, `${file}: label code ${JSON.stringify(label)} not found`).toBeGreaterThan(0);
  const open = src.lastIndexOf("<span", at);
  expect(open, `${file}: no <span before the label`).toBeGreaterThan(0);
  return src.slice(open, at);
}

describe("status pills are sentence case (Q2001)", () => {
  it("covers every registered pill", () => {
    expect(PILLS.length).toBeGreaterThan(4);
  });

  for (const p of PILLS) {
    it(`${p.what} (${p.file}) is not ALL CAPS`, () => {
      const opening = pillOpening(p.file, p.label);
      expect(opening, "uppercase class").not.toMatch(/(?<![\w-])uppercase(?![\w-])/);
      expect(opening, "caps letter-spacing class").not.toMatch(/(?<![\w-])tracking-wider(?![\w-])/);
      expect(opening, "caps inline letterSpacing").not.toMatch(/letterSpacing/);
    });
  }

  it("a warning's action reads in sentence case, not raw snake_case", () => {
    const src = blankComments(readFileSync("src/components/profile/WarningsTab.tsx", "utf8"));
    expect(src).not.toMatch(/\{v\.action_taken\.replace\(/);
    expect(src).toMatch(/function actionLabel\(/);
  });
});
