/**
 * Q2592 (owner decision, 11-02: "SOS goes inside More options on BOTH Working and Arrived"). Jobs audit 1102b row 6:
 * on Working the poster's row was [SOS | Message] (the card's ONE action drawn as the page's second button), while on
 * Arrived SOS sat inside More options. Now a lone SOS is never the second button: the row shows "More options" and the
 * sheet lists SOS, so it is in one place on every live stage.
 * @mutate src/pages/jobs/jobPage/JobPageActionRow.tsx |   const menuOnly = cardInMenu && cardCount > 0; |   const menuOnly = false;
 * @mutate src/components/job-card/JobStepCard.tsx | menu?.secondHost && menuCount === 1 && !loneSos ? createPortal( | menu?.secondHost && menuCount === 1 ? createPortal(
 * @mutate src/components/job-card/JobStepCard.tsx |   useEffect(() => { setMenuLoneSos?.(loneSos); }, [setMenuLoneSos, loneSos]); |   useEffect(() => { setMenuLoneSos?.(false); }, [setMenuLoneSos, loneSos]);
 * @mutate src/pages/jobs/jobPage/posterPageActions.tsx | cardInMenu={cardSteps && flows.loneSos} | cardInMenu={false}
 */
import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { JobPageActionRow } from "@/pages/jobs/jobPage/JobPageActionRow";
import { blankComments } from "@/test/helpers/blankNonCode";

const msg = { key: "message", label: "Message Eli", go: vi.fn() };

describe("Q2592 a lone SOS is inside More options, never beside Message", () => {
  it("the card's one action in the menu: the row is [More options | Message]; the sheet holds the card's list", () => {
    const listHost = vi.fn();
    const secondHost = vi.fn();
    render(<JobPageActionRow tag="poster" lead={msg} leadIsStep={false} extras={[]} cardCount={1} cardInMenu setCardSecondHost={secondHost} setCardListHost={listHost} />);
    const row = document.querySelector('[data-job-row="poster"]') as HTMLElement;
    expect(within(row).getAllByRole("button").map((b) => b.textContent)).toEqual(["More options", "Message"]);
    expect(secondHost).not.toHaveBeenCalledWith(expect.any(HTMLElement));
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    expect(listHost).toHaveBeenCalledWith(expect.any(HTMLElement));
  });

  it("any other lone card action stays the second button (a lone extra is never in a menu)", () => {
    const secondHost = vi.fn();
    render(<JobPageActionRow tag="poster" lead={msg} leadIsStep={false} extras={[]} cardCount={1} setCardSecondHost={secondHost} />);
    expect(screen.queryByRole("button", { name: "More options" })).toBeNull();
    expect(secondHost).toHaveBeenCalledWith(expect.any(HTMLElement));
  });

  it("the card says when its one action is SOS, and then draws it only in the list", () => {
    const card = blankComments(readFileSync("src/components/job-card/JobStepCard.tsx", "utf8"));
    expect(card).toContain("const loneSos = menuCount === 1 && isValidElement(menuChips[0]) && menuChips[0].type === SosShareButton;");
    expect(card).toContain("setMenuLoneSos?.(loneSos)");
    expect(card).toContain("menu?.secondHost && menuCount === 1 && !loneSos ? createPortal(");
    const page = blankComments(readFileSync("src/pages/jobs/jobPage/posterPageActions.tsx", "utf8"));
    expect(page).toContain("cardInMenu={cardSteps && flows.loneSos}");
    const flows = blankComments(readFileSync("src/pages/jobs/jobPage/usePosterPageFlows.tsx", "utf8"));
    expect(flows).toMatch(/setCount: setMoreCount, setLeadCount, setLoneSos \}/);
  });
});
