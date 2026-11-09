/**
 * The owner's message review of 11-09 (Part 3, ~/.lh-shots/ui-audit-1109/part3-messages-findings.md): the email copy
 * fixes, one block per finding, read from the template source (comments blanked).
 *
 * F163: the self-service email-change notice said "Your email address was changed" under a subject saying it "is
 * being changed" (nothing changes until the new address confirms), and its "Was this NOT you?" path had no button.
 * @mutate supabase/functions/_shared/email-templates/email-changed.tsx |       {SELF_CHANGE_HEADING}\n |       {HEADING}\n
 * @mutate supabase/functions/_shared/email-templates/email-changed.tsx |     <BrandButton href={`${getAppUrl()}/forgot-password`} | <BrandButton href={`${getAppUrl()}/profile`}
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");
const T = (f: string) => blankComments(readFileSync(join(ROOT, "supabase/functions/_shared/email-templates", f), "utf8"));

/** The body of `export const <name> = (...) => (...)` up to the next top-level export. */
function component(src: string, name: string): string {
  const at = src.indexOf(`export const ${name} = `);
  expect(at, name).toBeGreaterThan(-1);
  const next = src.indexOf("\nexport ", at + 1);
  return src.slice(at, next === -1 ? undefined : next);
}

describe("email copy, owner's message review 11-09", () => {
  it("F163: the email-change notice says it was ASKED for, and the not-you path has a reset button", () => {
    const src = T("email-changed.tsx");
    expect(src).toContain("export const SELF_CHANGE_HEADING = 'Someone asked to change your login email'");
    const self = component(src, "SelfEmailChangeNoticeEmail");
    expect(self).toContain("{SELF_CHANGE_HEADING}");
    expect(self).not.toMatch(/\{HEADING\}/);
    expect(self).toMatch(/<BrandButton href=\{`\$\{getAppUrl\(\)\}\/forgot-password`\} label="This wasn't me: reset my password"/);
    // The button goes to a real page.
    expect(readFileSync(join(ROOT, "src/App.tsx"), "utf8")).toMatch(/<Route path="\/forgot-password" /);
  });
});
