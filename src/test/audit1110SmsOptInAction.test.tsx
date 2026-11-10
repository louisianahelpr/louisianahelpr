/**
 * Whole-app audit 11-10, Builder 2. F417: /sms-opt-in opened on a wall of compliance text with nothing to do and no
 * way in. Three short steps and one "Turn on text alerts" button (log in, then straight to Profile > Notifications)
 * now come first; the Twilio-reviewed text below is unchanged (src/test/staticPagesRawHtml.test.ts guards it).
 *
 * @mutate src/pages/info/SmsOptInBody.tsx |           <Link to={SMS_OPT_IN_ACTION_HREF}>Turn on text alerts</Link> |           <Link to="/login">Turn on text alerts</Link>
 * @mutate src/pages/info/SmsOptInBody.tsx |         <h2 id="sms-opt-in-steps" className="font-serif text-ds-20 font-semibold">Three steps</h2> |         <p>Three steps</p>
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SMS_OPT_IN_ACTION_HREF, SmsOptInBody } from "@/pages/info/SmsOptInBody";

describe("F417: /sms-opt-in leads with the steps and the one action", () => {
  it("the button logs the reader in and lands on the Text alerts box; the steps are a headed list above the legal text", () => {
    render(<MemoryRouter><SmsOptInBody /></MemoryRouter>);
    const button = screen.getByRole("link", { name: "Turn on text alerts" });
    expect(button.getAttribute("href")).toBe("/login?redirect=%2Fprofile%3Ftab%3Dnotifications");
    expect(SMS_OPT_IN_ACTION_HREF).toBe("/login?redirect=%2Fprofile%3Ftab%3Dnotifications");
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Three steps", "How the opt-in works"]);
    const steps = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(steps).toHaveLength(3);
    expect(steps[0]).toMatch(/^Log in/);
    expect(steps[2]).toMatch(/reply YES/);
    // The steps and the button come before the first screenshot (the legal walk-through).
    const firstImg = document.querySelector("img")!;
    expect(button.compareDocumentPosition(firstImg) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
