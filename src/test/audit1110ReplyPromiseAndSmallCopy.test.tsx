/**
 * Whole-app audit 11-10, Builder 2 (five small copy / tap-size rows):
 *   F413 the help centre's "Still stuck?" footer promised a person but never a reply time; the shared promise sits there.
 *   F414 the support form said nothing about when to expect a reply until after Send; it now says so under the button.
 *   F467 the gift-card preview showed "$—" before an amount was picked, which read as a broken amount.
 *   F445 the bell's "Mark all read" looked like plain text; it carries the check icon.
 *   F259h "Back to log in" on /forgot-password and /reset-password was a 16px-tall link; it has a 44px tap box.
 *
 * @mutate src/pages/info/legal/LegalChrome.tsx | A real person reads every message. {SUPPORT_REPLY_PROMISE} | A real person reads every message.
 * @mutate src/pages/info/Support.tsx |                     We reply by email. {SUPPORT_REPLY_PROMISE}\n |
 * @mutate src/pages/profile/giftCards/GiftCardPreview.tsx | : "Pick an amount"} | : "$—"}
 * @mutate src/components/NotificationPanelView.tsx |                 <CheckCheck className="w-4 h-4 mr-1" aria-hidden />\n |
 * @mutate src/pages/auth/ForgotPassword.tsx | className="font-bold inline-flex items-center min-h-11 px-2" | className="font-bold"
 * @mutate src/pages/auth/ResetPassword.tsx | className="font-bold inline-flex items-center min-h-11 px-2" | className="font-bold"
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";
import { PolicyFooter } from "@/pages/info/legal/LegalChrome";
import { GiftCardPreview } from "@/pages/profile/giftCards/GiftCardPreview";
import { GIFT_OCCASIONS } from "@/pages/profile/giftCards/giftCardDesigns";
import { SUPPORT_REPLY_PROMISE } from "@/lib/supportTopics";

afterEach(() => cleanup());

const read = (p: string) => blankComments(readFileSync(p, "utf8"));

describe("F413: the help footer says when a reply comes", () => {
  it("Still stuck? carries the shared reply promise", () => {
    render(<MemoryRouter><PolicyFooter cta /></MemoryRouter>);
    const line = screen.getByText("Still stuck?").closest("p")!;
    expect(line.textContent).toContain(SUPPORT_REPLY_PROMISE);
    expect(line.textContent).toMatch(/^Still stuck\? A real person reads every message\. We usually/);
  });
});

describe("F414: the support form says when a reply comes before Send", () => {
  it("one line under the Send button, from the same constant as the sent screen", () => {
    const src = read("src/pages/info/Support.tsx");
    expect(src).toContain("We reply by email. {SUPPORT_REPLY_PROMISE}");
    expect(src.indexOf("We reply by email. {SUPPORT_REPLY_PROMISE}")).toBeGreaterThan(src.indexOf('selectedTopic?.submitLabel ?? "Send message"'));
  });
});

describe("F467: the gift-card preview asks for an amount instead of showing $—", () => {
  it("no amount: 'Pick an amount'; an amount: the dollars", () => {
    const design = GIFT_OCCASIONS[0].designs[0];
    render(<GiftCardPreview design={design} amount={null} />);
    expect(screen.getByTestId("gift-card-preview").textContent).toContain("Pick an amount");
    expect(screen.getByTestId("gift-card-preview").textContent).not.toContain("$—");
    cleanup();
    render(<GiftCardPreview design={design} amount={25} />);
    expect(screen.getByTestId("gift-card-preview").textContent).toContain("$25");
    expect(screen.getByTestId("gift-card-preview").textContent).not.toContain("Pick an amount");
  });
});

describe("F445: Mark all read is a button with an icon", () => {
  it("CheckCheck sits inside the mark-all-read Button", () => {
    const src = read("src/components/NotificationPanelView.tsx");
    const at = src.indexOf('data-testid="mark-all-read"');
    expect(at).toBeGreaterThan(-1);
    // F260q: the label is the dictionary's ("notif.markAllRead": "Mark all read").
    expect(src.slice(at, at + 400)).toMatch(/<CheckCheck [^>]*\/>\s*\{t\("notif\.markAllRead"\)\}/);
  });
});

describe("F259h: Back to log in has a 44px tap box", () => {
  it.each(["src/pages/auth/ForgotPassword.tsx", "src/pages/auth/ResetPassword.tsx"])("%s", (file) => {
    const src = read(file);
    const at = src.indexOf('<Link to="/login" className="font-bold');
    expect(at).toBeGreaterThan(-1);
    const tag = src.slice(at, src.indexOf(">", at));
    expect(tag).toContain("min-h-11");
    expect(tag).toContain("inline-flex items-center");
  });
});
