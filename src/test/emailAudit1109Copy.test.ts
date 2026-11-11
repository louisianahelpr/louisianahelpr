/**
 * The owner's message review of 11-09 (Part 3, ~/.lh-shots/ui-audit-1109/part3-messages-findings.md): the email copy
 * fixes, one block per finding, read from the template source (comments blanked).
 *
 * F163: the self-service email-change notice said "Your email address was changed" under a subject saying it "is
 * being changed" (nothing changes until the new address confirms), and its "Was this NOT you?" path had no button.
 * @mutate supabase/functions/_shared/email-templates/email-changed.tsx |       {SELF_CHANGE_HEADING}\n |       {HEADING}\n
 * @mutate supabase/functions/_shared/email-templates/email-changed.tsx |     <BrandButton href={`${getAppUrl()}/forgot-password`} | <BrandButton href={`${getAppUrl()}/profile`}
 *
 * F182: the strike-2 and strike-3 emails with a blank admin note said "regarding a platform policy violation:" and never said
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
    expect(src).toContain("const SELF_CHANGE_HEADING = 'Someone asked to change your login email'");
    const self = component(src, "SelfEmailChangeNoticeEmail");
    expect(self).toContain("{SELF_CHANGE_HEADING}");
    expect(self).not.toMatch(/\{HEADING\}/);
    expect(self).toMatch(/<BrandButton href=\{`\$\{getAppUrl\(\)\}\/forgot-password`\} label="This wasn't me: reset my password"/);
    // The button goes to a real page.
    expect(readFileSync(join(ROOT, "src/App.tsx"), "utf8")).toMatch(/<Route path="\/forgot-password" /);
  });

  // F169: the welcome drip's day 1 and day 3 said the same three things, and no welcome or come-back email named
  // Declutter (live for everyone). Day 3 is now the Declutter intro, opening /declutter; day 1 and come-back 1 carry
  // one Declutter line.
  // @mutate supabase/functions/_shared/email-templates/drip.tsx |       Clear out a closet on Declutter\n |       Explore what Louisiana Helpr has to offer\n
  // @mutate supabase/functions/engagement-automations/index.ts |     path: '/declutter', |     path: '/home',
  // @mutate supabase/functions/engagement-automations/index.ts | greetingName: person.full_name \|\| '',\n              dashboardUrl: `${getAppUrl()}${step.path}`, | greetingName: person.full_name \|\| '',\n              dashboardUrl: `${getAppUrl()}/home`,
  // @mutate supabase/functions/_shared/comeBackEmail.ts |       ["Got stuff to sell?", "List it on Declutter in a minute."],\n | \n
  it("F169: day 3 is the Declutter intro and opens /declutter; day 1 and come-back 1 name Declutter", () => {
    const drip = T("drip.tsx");
    const day1 = component(drip, "WelcomeDripStep1Email");
    const day3 = component(drip, "WelcomeDripStep2Email");
    expect(day3).toMatch(/>\s*Clear out a closet on Declutter\s*</);
    expect(day3).toContain('label="Open Declutter"');
    // F491 (audit 11-10) reworded the handover line; src/test/emailAudit1110Copy.test.ts pins the new words.
    expect(day3).toMatch(/snap a photo and set a garage-sale price\./);
    expect(day1).toContain("<Bold>Got stuff to sell?</Bold> List it on Declutter in a minute.");
    // Day 1 and day 3 no longer share a bullet.
    expect(day3).not.toMatch(/<li>/);
    for (const vague of ["find opportunities", "Connect", "message before committing"]) {
      expect(drip).not.toContain(vague);
    }
    const fn = blankComments(readFileSync(join(ROOT, "supabase/functions/engagement-automations/index.ts"), "utf8"));
    expect(fn).toMatch(/2: \{\s*component: WelcomeDripStep2Email,\s*subject: 'Clear out a closet on Declutter',\s*path: '\/declutter',/);
    expect(fn).toContain("dashboardUrl: `${getAppUrl()}${step.path}`,");
    // #4281 review (b31573466): the dead-letter re-send also builds a drip step, and it kept a hard-coded /home,
    // so a re-sent day 3 said "Open Declutter" and opened /home. Every drip-step build uses its step's path.
    const stepBuilds = [...fn.matchAll(/React\.createElement\(step\.component, \{[^}]*?dashboardUrl: ([^\n]*)/g)].map((m) => m[1].trim());
    expect(stepBuilds.length).toBeGreaterThan(1);
    for (const url of stepBuilds) expect(url).toBe("`${getAppUrl()}${step.path}`,");
    const comeBack = blankComments(readFileSync(join(ROOT, "supabase/functions/_shared/comeBackEmail.ts"), "utf8"));
    expect(comeBack).toContain('["Got stuff to sell?", "List it on Declutter in a minute."],');
  });

  // F159 F160 F161 F162 F164 F165 F166 F188: the account emails read like the newer ones (sentence case, "Tap",
  // plain words, "Louisiana Helpr" in subjects), name Declutter where the ID check applies, and drop staff jargon.
  // @mutate supabase/functions/_shared/email-templates/authEmailWords.ts | first time you post a job, take a job, list an item or buy one." | first time you post or accept a job."
  // @mutate supabase/functions/_shared/email-templates/authEmailWords.ts | Tap the button below to choose a new password.' | Click the button below to choose a new one.'
  // @mutate supabase/functions/_shared/email-templates/authEmailWords.ts |     heading: 'Your confirmation code', |     heading: 'Verify Your Identity',
  // @mutate supabase/functions/_shared/email-templates/account-status.tsx | buy and sell on\n        Declutter. | help neighbors.
  // @mutate supabase/functions/_shared/email-templates/authEmailWords.ts |     recovery: 'Reset your Louisiana Helpr password', |     recovery: 'Reset your Helpr password',
  it("F159-F166, F188: account emails in sentence case and plain words, with the brand's full name", () => {
    const has: Array<[string, string[], string[]]> = [
      // F260q: the account emails' words moved to authEmailWords.ts (English + Spanish); the templates render them.
      ["signup.tsx", ["{w.heading}", "label={w.button}", "{w.idNote}"], ["mailto:", "<Link", "Verify My Email"]],
      ["authEmailWords.ts", ["heading: 'Confirm your email'", "button: 'Confirm my email'", "finish setting up your Louisiana Helpr account.",
        "first time you post a job, take a job, list an item or buy one.", "heading: 'Reset your password'",
        "Tap the button below to choose a new password.", "button: 'Choose a new password'", "heading: 'Your confirmation code'",
        "heading: 'Confirm your email change'", "button: 'Confirm the change'", "heading: 'Your Louisiana Helpr code'"],
        ["Click", "Verify Your Identity", "your identity", "Confirm Email Change", "Your Helpr Code", "Verify My Email"]],
      ["recovery.tsx", ["{w.heading}", "label={w.button}"], ["Click"]],
      ["invite.tsx", [">You've been invited to Louisiana Helpr<", 'label="Accept the invite"'], ["<Link", "Accept Invitation"]],
      ["reauthentication.tsx", ["{w.heading}"], ["Verify Your Identity", "your identity"]],
      ["email-change.tsx", ["{w.heading}", "label={w.button}"], ["Confirm Email Change"]],
      ["magic-link.tsx", ["{w.heading}"], ["Your Helpr Code"]],
      ["email-changed.tsx", ["Someone from Louisiana Helpr changed the email on your account"], ["administrator", "authorise"]],
      ["account-status.tsx", ["buy and sell on\n        Declutter.", "cta: 'Open Louisiana Helpr'"], ["fully approved", "Go to Dashboard", "copy.note"]],
    ];
    for (const [file, yes, no] of has) {
      const src = T(file);
      for (const y of yes) expect(src, `${file} says ${y}`).toContain(y);
      for (const n of no) expect(src, `${file} no longer says ${n}`).not.toContain(n);
    }
    // Subjects live in authEmailWords.ts (AUTH_EMAIL_SUBJECTS, F260q); the hook sends authEmailSubject(type, lang).
    const hook = T("authEmailWords.ts");
    expect(hook).toContain("recovery: 'Reset your Louisiana Helpr password',");
    for (const subj of ["You've been invited to Louisiana Helpr", "Your Louisiana Helpr code", "Reset your Louisiana Helpr password", "Your confirmation code"]) {
      expect(hook).toContain(subj);
    }
  });

  // F184 F185 (and F159 F162 F188 in the admin emails): strike emails in plain words with a "Read the rules" button, the
  // ID re-upload note labelled "Note from our team" with a dark-mode colour, its button straight to the ID step.
  // @mutate supabase/functions/admin-user-actions/index.ts |           ctaUrl: `${appUrl}/home?verify_id=1`, |           ctaUrl: `${appUrl}/profile`,
  // @mutate supabase/functions/_shared/email-templates/admin-action.tsx |     <Section className={note ? 'e-note' : undefined} style={boxed}> |     <Section style={boxed}>
  // @mutate supabase/functions/admin-user-actions/index.ts |           ctaLabel: 'Read the rules', |           ctaLabel: 'Review Platform Rules',
  it("F184, F185: strike and ID emails in plain words; the note box goes dark in dark mode; the button opens the ID step", () => {
    const src = blankComments(readFileSync(join(ROOT, "supabase/functions/admin-user-actions/index.ts"), "utf8"));
    for (const y of ["ctaLabel: 'Read the rules',", "We\\'re writing because something on your account broke our community rules:",
      "{ b: 'Note from our team:' }", "ctaUrl: `${appUrl}/home?verify_id=1`,", "ctaLabel: 'Upload a clearer photo',",
      "Tap the button below to choose a new password.", "subject: 'Reset your Louisiana Helpr password',",
      "subject: 'Louisiana Helpr: please upload a clearer ID photo',", "emailSubject = 'Louisiana Helpr: formal warning on your account'"]) {
      expect(src, y).toContain(y);
    }
    for (const n of ["Review Platform Rules", "platform policy violation", "Admin note:", "Re-upload ID", "Click the button", "'Go to Dashboard'", "Helpr —"]) {
      expect(src, n).not.toContain(n);
    }
    expect(T("admin-action.tsx")).toContain("<Section className={note ? 'e-note' : undefined} style={boxed}>");
    expect(T("styles.ts")).toMatch(/\.e-note \{ background-color:#2A2B20 !important;[^}]*\}\s*\.e-note-text \{ color:#F2F2E9 !important; \}/);
  });

  // F168 (day 7 speaks to everyone, never only Helprs), F172 (gift credit names the giver and Declutter), F187 (one
  // "member" in the errors row).
  // @mutate supabase/functions/_shared/email-templates/drip.tsx |       Hey {greetingName \|\| 'there'}, four things that make every job and sale go smoothly: |       Hey {greetingName \|\| 'there'} — four things the Helprs who get rebooked do well:
  // @mutate supabase/functions/_shared/email-templates/gift-card.tsx |       {donorFirstName(donorName)} wants to help you get something done. |       Someone wants to help you get something done.
  // @mutate supabase/functions/_shared/email-templates/lifecycle.tsx |         label="App errors"\n |         label="App errors members hit"\n
  it("F168, F172, F187: day 7 is for everyone, the gift names its giver and Declutter, the errors row says member once", () => {
    const day7 = component(T("drip.tsx"), "WelcomeDripStep3Email");
    expect(day7).toContain("four things that make every job and sale go smoothly:");
    expect(day7).toContain("<Bold>Stay safe:</Bold> keep messages and payments in the app");
    expect(day7).toContain('label="Open Louisiana Helpr"');
    expect(day7).not.toMatch(/Helprs who get rebooked|platform|Start Now/);
    const fn = blankComments(readFileSync(join(ROOT, "supabase/functions/engagement-automations/index.ts"), "utf8"));
    expect(fn).toContain("subject: 'Four tips from neighbors who use Helpr a lot',");
    const gift = T("gift-card.tsx");
    expect(gift).toContain("{donorFirstName(donorName)} wants to help you get something done.");
    expect(gift).toContain("and on Declutter buys.");
    expect(gift).not.toContain("Someone wants");
    const daily = component(T("lifecycle.tsx"), "OwnerDailySummaryEmail");
    expect(daily).toContain('label="App errors"');
    expect(daily).toContain("(hit ${stats.membersWithErrors} ");
  });
});
