/**
 * Owner 11-17: Louisiana Helpr's own notice emails ("New application", "Offer expired", "Reset your password") landed
 * in Gmail SPAM for admin@, while the 25 Days sponsor notices from the same sender, same domain, same DKIM went to the
 * inbox. Measured on admin@'s copy of a "New application" email (2026-10-25): dkim=pass (d=louisianahelpr.com,
 * s=resend), spf=pass (send.louisianahelpr.com), dmarc=pass. Authentication was fine; the CONTENT was the difference:
 *   - the inbox line was "New application — open Helpr for the details.": the same vague preheader under every notice;
 *   - the body was one sentence and a button (a link-only notice);
 *   - the subject was the bare title, so one member got 40 identical "New application" emails (one Gmail thread);
 *   - the From name said "Helpr" while every body signs "Louisiana Helpr".
 * The sponsor notice names the thing in its subject, writes several sentences, and carries the address footer.
 *
 * The class, read from the source (comments blanked) and the real pure helpers:
 *   1. no template carries a fixed "for the details" preheader; the notice email previews its own message;
 *   2. the notice subject names the job or item its message quotes, and the sender sends that subject;
 *   3. every email layout has at least two body text blocks, except an exact list of the ones still short;
 *   4. every send has a plain-text part: sendWithResend refuses an empty one, renderEmail asks react-email for it,
 *      and nothing reaches Resend except through _shared/resend.ts;
 *   5. the From display name is the name the emails sign with ("Louisiana Helpr").
 * The address footer on every template is guarded by src/test/emailFootersCarryPostalAddress.test.ts.
 *
 * @mutate supabase/functions/_shared/email-templates/notification.tsx | preheader={noticePreheader(message)} | preheader={`${title} — open Louisiana Helpr for the details.`}
 * @mutate supabase/functions/send-notification-email/index.ts | const subject = noticeSubject(heading, readerMessage) | const subject = heading
 * @mutate supabase/functions/_shared/email-templates/notificationAction.ts | return `${t}: "${short}"`; | return t;
 * @mutate supabase/functions/_shared/resend.ts | const SENDER_NAME = "Louisiana Helpr"; | const SENDER_NAME = "Helpr";
 * @mutate supabase/functions/_shared/email-templates/recovery.tsx | <Text className="e-text" style={{ ...text, margin: '20px 0 0' }}>{w.once}</Text> | {null}
 * @mutate supabase/functions/_shared/email-templates/notification.tsx | {w.more} | {null}
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
// The repo's readdirSync (lists src/ from git; anything else, here supabase/, straight from disk).
import { readdirSync } from "./helpers/trackedFiles";
import {
  NOTICE_SIGNOFF,
  noticePreheader,
  noticeSubject,
} from "../../supabase/functions/_shared/email-templates/notificationAction";

const ROOT = resolve(__dirname, "..", "..");
const FUNCTIONS = join(ROOT, "supabase/functions");
const TEMPLATES = join(FUNCTIONS, "_shared/email-templates");
const read = (p: string) => blankComments(readFileSync(p, "utf8"));

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (e.name === "node_modules" ? [] : walk(join(dir, e.name))) : [join(dir, e.name)],
  );
}

/**
 * Layouts still written as one short block (file#n = the n-th BaseLayout in the file), EXACT both ways: when one gets
 * a second block, take it off this list. marketing-blast's body is the admin's own campaign text, not template words.
 */
const ONE_BLOCK_LAYOUTS = ["email-change.tsx#1", "invite.tsx#1", "lifecycle.tsx#1", "marketing-blast.tsx#1"];

describe("transactional emails are not thin (owner 11-17, notices in Gmail spam)", () => {
  it("no template carries the vague 'for the details' preheader; the notice email previews its own message", () => {
    const files = readdirSync(TEMPLATES).filter((f) => /\.(tsx|ts)$/.test(f));
    expect(files.length).toBeGreaterThan(20);
    const vague = files.filter((f) => /for the details|para ver los detalles/i.test(read(join(TEMPLATES, f))));
    expect(vague).toEqual([]);
    const tpl = read(join(TEMPLATES, "notification.tsx"));
    expect(tpl).toContain("preheader={noticePreheader(message)}");
    expect(tpl).toMatch(/<Text className="e-text" style=\{textStyle\}>\s*\{w\.more\}\s*<\/Text>/);
    expect(noticePreheader('Neosha W. applied to "Pick up packages"')).toBe('Neosha W. applied to "Pick up packages"');
    expect(noticePreheader("x ".repeat(200)).length).toBeLessThanOrEqual(140);
  });

  it("the notice subject names the job or item the message quotes", () => {
    expect(noticeSubject("New application", 'Neosha W. applied to "Pick up packages/ deliver to UPS"')).toBe(
      'New application: "Pick up packages/ deliver to UPS"',
    );
    expect(noticeSubject("Offer expired", "Your offer on “Blue couch” expired.")).toBe('Offer expired: "Blue couch"');
    // Nothing quoted, or a title that already quotes: the title as it is.
    expect(noticeSubject("Refund issued: $72.52", "Your refund is on its way.")).toBe("Refund issued: $72.52");
    expect(noticeSubject('Booked: "Mow lawn"', 'You booked "Mow lawn".')).toBe('Booked: "Mow lawn"');
    const long = noticeSubject("New job posted", `"${"a".repeat(120)}" was just posted.`);
    expect(long.length).toBeLessThan(90);
  });

  it("send-notification-email sends that subject on both paths and keeps the plain title as the heading", () => {
    const src = read(join(FUNCTIONS, "send-notification-email/index.ts"));
    expect(src).toContain("const subject = noticeSubject(heading, readerMessage)");
    expect(src).toMatch(/renderNotificationEmail\(\s*heading,\s*readerMessage,/);
    expect(src.match(/\bfrom: FROM_DEFAULT,\s*subject,/g)?.length).toBe(2);
  });

  it("every email layout has at least two body text blocks, except the exact short list", () => {
    const files = readdirSync(TEMPLATES).filter((f) => f.endsWith(".tsx") && f !== "components.tsx");
    const short: string[] = [];
    let layouts = 0;
    for (const f of files) {
      const src = read(join(TEMPLATES, f));
      let n = 0;
      for (let at = src.indexOf("<BaseLayout"); at !== -1; at = src.indexOf("<BaseLayout", at + 1)) {
        n++;
        layouts++;
        const end = src.indexOf("</BaseLayout>", at);
        expect(end, `${f}: unclosed BaseLayout`).toBeGreaterThan(at);
        const blocks = (src.slice(at, end).match(/<Text\b/g) ?? []).length;
        if (blocks < 2) short.push(`${f}#${n}`);
      }
    }
    expect(layouts).toBeGreaterThan(20);
    expect(short.sort()).toEqual([...ONE_BLOCK_LAYOUTS].sort());
    // The two the owner named: the notice (greeting, message, next step, sign-off) and the password reset.
    expect(short).not.toContain("notification.tsx#1");
    expect(short).not.toContain("recovery.tsx#1");
  });

  it("every send has a plain-text part, and nothing reaches Resend except through _shared/resend.ts", () => {
    const resend = read(join(FUNCTIONS, "_shared/resend.ts"));
    expect(resend).toMatch(/if \(!params\.text \|\| !params\.text\.trim\(\)\) \{[\s\S]{0,400}?throw err/);
    expect(resend).toMatch(/text: params\.text,/);
    expect(read(join(TEMPLATES, "render.ts"))).toContain("renderAsync(element, { plainText: true })");
    const files = walk(FUNCTIONS).filter((f) => /\.(ts|tsx)$/.test(f));
    expect(files.length).toBeGreaterThan(300);
    const direct = files
      .filter((f) => !f.endsWith("_shared/resend.ts"))
      .filter((f) => /api\.resend\.com\/emails|\.emails\.send\(/.test(read(f)))
      .map((f) => f.slice(ROOT.length + 1));
    expect(direct).toEqual([]);
  });

  it("the From display name is the name every email signs with", () => {
    const resend = read(join(FUNCTIONS, "_shared/resend.ts"));
    expect(NOTICE_SIGNOFF).toBe("Louisiana Helpr");
    expect(resend).toContain(`const SENDER_NAME = "${NOTICE_SIGNOFF}";`);
    expect(resend).toContain("export const FROM_DEFAULT = `${SENDER_NAME} <${SENDER_ADDRESS}>`;");
  });
});
