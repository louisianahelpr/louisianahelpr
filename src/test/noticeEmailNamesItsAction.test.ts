/**
 * AUD31-20 (Declutter emails and notices, audit 2026-10-31): the notice email signed off "— The Helpr Team" (the site
 * is Louisiana Helpr) and its one button said "View Details" whatever the notice was about. The button now names where
 * it goes, read from the notice's own link (notificationActionLabel), and the sign-off is the site's name.
 *
 * @mutate supabase/functions/_shared/email-templates/notificationAction.ts | export const NOTICE_SIGNOFF = "Louisiana Helpr"; | export const NOTICE_SIGNOFF = "The Helpr Team";
 * @mutate supabase/functions/_shared/email-templates/notificationAction.ts |     if (/[?&](tab\|view)=buying\b/.test(link ?? "")) return "See your order"; |
 * @mutate supabase/functions/_shared/email-templates/notificationAction.ts |   if (path.startsWith("/messages")) return "Read the message"; |
 * @mutate supabase/functions/_shared/email-templates/notification.tsx | <BrandButton href={actionUrl} label={actionLabel} widthPx={230} /> | <BrandButton href={actionUrl} label="View Details" widthPx={230} />
 * @mutate supabase/functions/send-notification-email/index.ts |       actionLabel: notificationActionLabel(link),\n |
 *
 * AUD31-21: the email broke "7-" / "day pickup deadline" across lines at 1440; the number and its unit now hold.
 * @mutate supabase/functions/_shared/email-templates/notificationAction.ts | "$1\u2011$2" | "$1-$2"
 * @mutate supabase/functions/_shared/email-templates/notification.tsx | {keepNumberUnitsTogether(message)} | {message}
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { NOTICE_SIGNOFF, keepNumberUnitsTogether, notificationActionLabel } from "../../supabase/functions/_shared/email-templates/notificationAction";

const read = (p: string) => blankComments(readFileSync(join(process.cwd(), p), "utf8"));

describe("the notice email names its action and signs off as Louisiana Helpr (AUD31-20)", () => {
  const cases: [string | null, string][] = [
    ["/declutter?tab=buying&order=1", "See your order"],
    ["/declutter?view=buying", "See your order"],
    ["/declutter?tab=selling", "See your sale"],
    ["/declutter?view=cart", "See your cart"],
    ["/declutter/item/abc", "See the item"],
    ["/declutter?tab=wanted", "Open Declutter"],
    ["/messages?jobId=1", "Read the message"],
    ["/jobs?job=1", "See the job"],
    ["/posts?highlight=1", "See the job"],
    ["/profile?tab=earnings", "See your earnings"],
    [null, "Open Louisiana Helpr"],
    ["/home", "Open Louisiana Helpr"],
  ];

  it("every link family gets words that say where the button goes, never View Details", () => {
    expect(cases.length).toBeGreaterThan(10);
    for (const [link, label] of cases) expect(notificationActionLabel(link), String(link)).toBe(label);
    for (const [link] of cases) expect(notificationActionLabel(link)).not.toMatch(/view details/i);
  });

  it("the template draws that label and the site's name; the sender passes the label from the notice's link", () => {
    expect(NOTICE_SIGNOFF).toBe("Louisiana Helpr");
    const tpl = read("supabase/functions/_shared/email-templates/notification.tsx");
    expect(tpl).toContain("const SIGNOFF = NOTICE_SIGNOFF");
    expect(tpl).toContain("<BrandButton href={actionUrl} label={actionLabel} widthPx={230} />");
    expect(tpl).not.toMatch(/View Details|The Helpr Team|open Helpr for/);
    const sender = read("supabase/functions/send-notification-email/index.ts");
    expect(sender).toContain("actionLabel: notificationActionLabel(link),");
  });

  it("a number and its unit never break at the hyphen (AUD31-21)", () => {
    const msg = "You can book one new time before your 7-day pickup deadline. Answer within 24-hours or 2-weeks.";
    const out = keepNumberUnitsTogether(msg);
    expect(out).toContain("7\u2011day pickup deadline");
    expect(out).toContain("24\u2011hours");
    expect(out).toContain("2\u2011weeks");
    expect(out).not.toMatch(/\d-(day|hour|week)/);
    expect(keepNumberUnitsTogether("drop-off at 5-6 PM")).toBe("drop-off at 5-6 PM");
    expect(read("supabase/functions/_shared/email-templates/notification.tsx")).toContain("{keepNumberUnitsTogether(message)}");
  });
});
