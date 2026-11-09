/**
 * The owner's message review of 11-09 (Part 3, ~/.lh-shots/ui-audit-1109/part3-messages-findings.md): the email copy
 * fixes, one block per finding, read from the template source (comments blanked).
 *
 * F163: the self-service email-change notice said "Your email address was changed" under a subject saying it "is
 * being changed" (nothing changes until the new address confirms), and its "Was this NOT you?" path had no button.
 * @mutate supabase/functions/_shared/email-templates/email-changed.tsx |       {SELF_CHANGE_HEADING}\n |       {HEADING}\n
 * @mutate supabase/functions/_shared/email-templates/email-changed.tsx |     <BrandButton href={`${getAppUrl()}/forgot-password`} | <BrandButton href={`${getAppUrl()}/profile`}
 *
 * F182: strike 2 and 3 emails with a blank admin note said "regarding a platform policy violation:" and never said
 * what it was; strike 2's subject was in shouting caps.
 * @mutate supabase/functions/admin-user-actions/index.ts |               : STRIKE_NO_NOTE_LINE, |               : 'You\'ve received a formal warning regarding a platform policy violation:',
 * @mutate supabase/functions/admin-user-actions/index.ts |         emailSubject = 'Louisiana Helpr: final warning on your account' |         emailSubject = 'Helpr — FINAL warning'
 *
 * F186: the weekly admin summary's subject said "Week of Nov 9" and its body "the past 7 days (week of Nov 2)", two
 * weeks for one report, and it had no Declutter numbers (the daily summary has them).
 * @mutate supabase/functions/engagement-automations/index.ts |   const subject = `Louisiana Helpr weekly summary: ${range}` |   const subject = `Louisiana Helpr weekly summary: week of ${centralDayLabel(now)}`
 * @mutate supabase/functions/_shared/email-templates/lifecycle.tsx | toFixed(2)}`} />\n      <Stat label="Declutter items posted" value={stats.itemsPosted} />\n | toFixed(2)}`} />\n
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
  it("F186: the weekly summary names one date range in subject and body, and counts Declutter", () => {
    const fn = blankComments(readFileSync(join(ROOT, "supabase/functions/engagement-automations/index.ts"), "utf8"));
    expect(fn).toMatch(/return `\$\{centralDayLabel\(first\)\} – \$\{centralDayLabel\(last\)\}`/);
    expect(fn).toContain("const subject = `Louisiana Helpr weekly summary: ${range}`");
    expect(fn).toMatch(/React\.createElement\(AdminDigestEmail, \{[\s\S]*?\brange,/);
    // One server read for every digest number (b5-digest-chunk's design); Declutter's three keys come from it too.
    expect(fn.match(/\.rpc\('owner_daily_summary_stats', \{ p_since: weekAgo \}\)/g)).toHaveLength(1);
    for (const key of ["items_posted", "items_sold", "sales_cents"]) expect(fn).toContain(`weekNum('${key}')`);
    const tpl = component(T("lifecycle.tsx"), "AdminDigestEmail");
    expect(tpl).toContain("{range} (Central):");
    expect(tpl).not.toMatch(/week of/i);
    for (const label of ["Declutter items posted", "Declutter items sold", "Declutter sales", "New sign-ups"]) expect(tpl).toContain(`label="${label}"`);
  });

  it("F182: a strike email with no admin note still says what happened, in plain words; subjects in sentence case", () => {
    const src = blankComments(readFileSync(join(ROOT, "supabase/functions/admin-user-actions/index.ts"), "utf8"));
    expect(src).toContain("const STRIKE_NO_NOTE_LINE = 'Our team found a break of the community rules. Reply to this email if you\\'d like to know more.'");
    expect(src).toMatch(/paragraphs: \[\s*note\s*\?[\s\S]*?: STRIKE_NO_NOTE_LINE,\s*\]/);
    expect(src).toContain("emailSubject = 'Louisiana Helpr: final warning on your account'");
    expect(src).toContain("emailSubject = 'Louisiana Helpr: your account is paused for 7 days'");
    expect(src).not.toMatch(/FINAL warning/);
  });

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
