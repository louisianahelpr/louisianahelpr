/**
 * THE SMS WORDS TWILIO'S A2P CAMPAIGN REVIEW READS (owner, 2026-10-23, filling the A2P 10DLC campaign form).
 * Twilio checks the live pages for exact text:
 *  - /privacy (title "Privacy Policy"): the sentence "We do not sell or share your SMS opt-in data or personal
 *    information with third parties for marketing purposes." and the registered brand name "Louisiana Helpr";
 *  - /terms (title "Terms of Service"): a section titled "SMS Terms" with "Message and data rates may apply" and the
 *    brand name "Louisiana Helpr", plus STOP / HELP and the carrier line that were already there.
 * A reword that drops any of it fails the campaign, so it fails here first.
 *
 * @mutate src/pages/info/legal/PrivacySection.tsx | We do not sell or share your SMS opt-in data or personal information with third parties for marketing purposes. | We do not sell your SMS opt-in data.
 * @mutate src/pages/info/legal/PrivacySection.tsx | text alerts from Louisiana Helpr, we use | text alerts, we use
 * @mutate src/pages/info/legal/TermsSection.tsx |         title="SMS Terms" |         title="Text alerts"
 * @mutate src/pages/info/legal/TermsSection.tsx | Message and data rates may apply. | Msg &amp; data rates may apply.
 * @mutate src/pages/info/legal/TermsSection.tsx | Louisiana Helpr text alerts are optional. | Text alerts are optional.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { LEGAL_PAGE_META } from "@/lib/publicPageMeta.mjs";

const ROOT = resolve(__dirname, "..", "..");
const code = (f: string) => blankComments(readFileSync(resolve(ROOT, f), "utf8"));

describe("the SMS words Twilio's A2P review reads", () => {
  it("/privacy: the exact no-sale sentence and the brand name, in the Text messages row", () => {
    const privacy = code("src/pages/info/legal/PrivacySection.tsx");
    const row = privacy.slice(privacy.indexOf('title="Text messages"'), privacy.indexOf("</p>}", privacy.indexOf('title="Text messages"')));
    expect(row).toContain("We do not sell or share your SMS opt-in data or personal information with third parties for marketing purposes.");
    expect(row).toContain("Louisiana Helpr");
    expect(row).toContain("Reply STOP");
    expect(LEGAL_PAGE_META.privacy.title).toMatch(/^Privacy Policy\b/);
  });

  it("/terms: a section titled SMS Terms with the brand name, the rates line, STOP, HELP and the carrier line", () => {
    const terms = code("src/pages/info/legal/TermsSection.tsx");
    const start = terms.indexOf('title="SMS Terms"');
    expect(start).toBeGreaterThan(0);
    const row = terms.slice(start, terms.indexOf("</p>}", start));
    expect(row).toMatch(/<p>Louisiana Helpr text alerts are optional\./);
    expect(row).toContain("Message and data rates may apply.");
    expect(row).toContain("Reply STOP to cancel or HELP for help");
    expect(row).toContain("Carriers are not liable for delayed or undelivered messages.");
    expect(LEGAL_PAGE_META.terms.title).toMatch(/^Terms of Service\b/);
  });
});
