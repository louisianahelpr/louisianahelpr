/**
 * Whole-app audit 11-10, Builder 2:
 *   F250 /sms-opt-in signed out: the page read as compliance language with no first line saying what a visitor can
 *         do. The first words are now "Text alerts are optional. Turn them on in Profile, Notifications, Text alerts."
 *         above the three steps and the Log in / Turn on text alerts button F417 added.
 *
 * @mutate src/pages/info/SmsOptInBody.tsx | Text alerts are optional. Turn them on in Profile, Notifications, Text alerts. | Turn them on in Profile, Notifications, Text alerts.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SmsOptInBody } from "@/pages/info/SmsOptInBody";

afterEach(() => cleanup());

describe("F250: /sms-opt-in opens with the one-line answer", () => {
  it("the first text on the page is the optional line, before the steps and the log-in button", () => {
    const { container } = render(<MemoryRouter><SmsOptInBody /></MemoryRouter>);
    const lead = container.querySelector("[data-sms-opt-in-lead]");
    expect(lead).not.toBeNull();
    expect(lead!.textContent).toBe("Text alerts are optional. Turn them on in Profile, Notifications, Text alerts.");
    const text = container.textContent ?? "";
    expect(text.indexOf("Text alerts are optional.")).toBe(0);
    expect(text.indexOf("Text alerts are optional.")).toBeLessThan(text.indexOf("Three steps"));
    expect(container.querySelector('a[href^="/login?redirect="]')).not.toBeNull();
  });
});
