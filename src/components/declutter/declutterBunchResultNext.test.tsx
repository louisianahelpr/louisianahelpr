/**
 * A3-69 + A3-70 (audit 2026-11-01): the bunch's "What happened" screen had no next step, three equal outline buttons,
 * and the empty intake under it; a held item said only "(waiting for a review)". Now: a NextStep line ("Next: wait
 * for buyers..."), ONE green primary "See your listings" on the right (List more and Share outline), the intro and
 * the photo step hidden until List more; a held item says "being checked" with the Home screen's notice words.
 *
 * @mutate src/components/declutter/DeclutterBunchResults.tsx |       <NextStep value={next} /> |
 * @mutate src/components/declutter/DeclutterBunchResults.tsx |           <Button asChild variant="primary" size="sm" className="rounded-full"> |           <Button asChild variant="outline" size="sm" className="rounded-full">
 * @mutate src/components/declutter/DeclutterBunchResults.tsx |             {review > 0 ? ` ${BEING_CHECKED}` : ""} |
 * @mutate src/components/declutter/DeclutterBunchView.tsx |   const allListed = !!results && items.length === 0; |   const allListed = false;
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("@/lib/nativeShare", () => ({ shareNative: vi.fn() }));
import { BunchResults } from "./DeclutterBunchResults";

const show = (results: Parameters<typeof BunchResults>[0]["results"]) =>
  render(<MemoryRouter><BunchResults results={results} userId="u1" inSale={false} onFix={() => {}} onListMore={() => {}} /></MemoryRouter>);

describe("Sell a bunch result: next step and one primary (A3-69, A3-70)", () => {
  it("listed: 'Next: wait for buyers...' and See your listings is the one primary, last (right)", () => {
    show([{ key: "a", title: "Lamp", status: "live", id: "i1" }, { key: "b", title: "Rug", status: "live", id: "i2" }]);
    expect(document.querySelector("[data-next-step]")?.textContent).toBe("Next: wait for buyers. We tell you when someone buys or makes an offer.");
    const actions = document.querySelector("[data-bunch-actions]") as HTMLElement;
    const buttons = [...actions.children] as HTMLElement[];
    expect(buttons.map((b) => b.textContent)).toEqual(["List more", "Share your listings", "See your listings"]);
    expect(buttons[2].className).toMatch(/btn-grad-primary/);
    expect(buttons.slice(0, 2).every((b) => !/btn-grad-primary/.test(b.className))).toBe(true);
  });

  it("a held item: 'being checked' with the notice words, never 'waiting for a review'", () => {
    show([{ key: "a", title: "Lamp", status: "live", id: "i1" }, { key: "b", title: "Rug", status: "pending_review", id: "i2" }]);
    expect(document.querySelector("[data-bunch-listed]")?.textContent).toBe("1 for sale, 1 being checked. We'll send you a notice when it's done.");
    expect(screen.getByText(/\(being checked\)/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/waiting for a review/);
  });

  it("only held items: the line says where it stands, not 'wait for buyers'", () => {
    show([{ key: "b", title: "Rug", status: "pending_review", id: "i2" }]);
    expect(document.querySelector("[data-next-step]")?.textContent).toBe("Being checked. We'll send you a notice when it's done.");
  });

  it("the page hides the intro, the pickup step and the photo step once everything is listed", () => {
    const src = blankComments(readFileSync("src/components/declutter/DeclutterBunchView.tsx", "utf8")).replace(/\s+/g, " ");
    expect(src).toContain("const allListed = !!results && items.length === 0;");
    expect(src).toContain("{!allListed && ( <p className=\"text-sm text-muted-foreground\"> Add photos of everything");
    expect(src).toContain("{whereFolded || allListed ? null : (");
    expect(src).toContain("{!allListed && ( <BunchSection id=\"bunch-photos\"");
  });
});
