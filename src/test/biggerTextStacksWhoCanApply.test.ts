/**
 * F279a (audit 11-10): with Bigger text on a phone, Post a job step 3's three "Who can apply" choices clipped their
 * words ("Licensed + Insured") at a third of the row each. Under 640px, Bigger text (html.senior-mode) stacks them,
 * one full-width row each with the icon beside the words. A stylesheet rule, so this reads index.css and the hook the
 * radiogroup carries.
 *
 * @mutate src/index.css |   html.senior-mode [data-cred-tiers] { grid-template-columns: minmax(0, 1fr); } |   html.senior-mode [data-cred-tiers] { gap: 6px; }
 * @mutate src/components/postjob/detailsSection/CredentialTierSelector.tsx |         data-cred-tiers="" |         data-cred-tiers-off=""
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments, blankCssComments } from "./helpers/blankNonCode";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

describe("Bigger text stacks Post a job's who-can-apply choices on a phone (F279a)", () => {
  it("under 640px, senior-mode gives the choices one column and lays each one out in a row", () => {
    const css = blankCssComments(read("src/index.css"));
    const block = css.match(/@media \(max-width: 639px\) \{\s*html\.senior-mode \[data-cred-tiers\][^]*?\n\}/)?.[0] ?? "";
    expect(block).toContain("html.senior-mode [data-cred-tiers] { grid-template-columns: minmax(0, 1fr); }");
    expect(block).toMatch(/html\.senior-mode \[data-cred-tiers\] > button \{ flex-direction: row;/);
  });

  it("the who-can-apply radiogroup carries the hook", () => {
    const src = blankComments(read("src/components/postjob/detailsSection/CredentialTierSelector.tsx"));
    expect(src).toMatch(/role="radiogroup"[^>]*data-cred-tiers=""/);
  });
});
