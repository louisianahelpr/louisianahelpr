/**
 * Whole-app audit 11-10, Builder 2:
 *   F239 /rules opened with five long bullets and the numbers that matter (24+ hours, the approval window, 72-hour)
 *     were buried in them; they are bold now, the words unchanged.
 *   F238 /privacy's short version did not answer "who sees my ID"; one line says Stripe checks it and no member sees it.
 *
 * @mutate src/pages/info/legal/CommunitySection.tsx | <strong className="font-semibold">24+ hours</strong> | 24+ hours
 * @mutate src/pages/info/legal/CommunitySection.tsx | <strong className="font-semibold">72-hour</strong> | 72-hour
 * @mutate src/pages/info/legal/PrivacySection.tsx |         "Your photo ID is checked by Stripe and never shown to other members.",\n |
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";
import { CommunityContent } from "@/pages/info/legal/CommunitySection";

afterEach(() => cleanup());

describe("F239: the rules short version bolds its numbers", () => {
  it("24+ hours, the approval window and 72-hour are <strong>; the sentences read the same", () => {
    render(<MemoryRouter><CommunityContent /></MemoryRouter>);
    const card = screen.getByText("The short version").closest("div.rounded-\\[20px\\]") as HTMLElement;
    const strong = [...card.querySelectorAll("li strong")].map((s) => s.textContent);
    expect(strong).toContain("24+ hours");
    expect(strong).toContain("72-hour");
    expect(strong.some((s) => /^\d+ hours$/.test(s ?? ""))).toBe(true);
    const items = [...card.querySelectorAll("li")].map((li) => li.textContent ?? "");
    expect(items[0]).toMatch(/^Cancel free 24\+ hours ahead\. Inside 24h, part of the job goes to the Helpr/);
    expect(items[2]).toMatch(/Each step has a 72-hour window\.$/);
  });
});

describe("F238: the privacy short version says who sees your ID", () => {
  it("one line, for every reader", () => {
    const src = blankComments(readFileSync("src/pages/info/legal/PrivacySection.tsx", "utf8"));
    expect(src).toContain('"Your photo ID is checked by Stripe and never shown to other members.",');
  });
});
