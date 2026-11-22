/**
 * The gift tags maker's radios render at their own small size (NativeRadio: h-4 w-4 min-h-0), with the 44px tap
 * target on the label around each one. The fun pages' typing-box rule (`.gg-fun input{min-height:44px;padding;border..}`)
 * matched radios too, and at (0,1,1) it beat the radio's own min-h-0 (0,1,0): every printables radio rendered a 44px
 * box, and the changed-screen sweep's button geometry check went red on the page ("size class ignored: input asks
 * min-h-0 (0px), renders 44.0px", 19 radios x 2), so every push that touched the guides needed LH_SKIP_CHANGED_CHECK.
 * The rule now skips radios and checkboxes; the look is unchanged (before/after screenshots at 375 match pixel for pixel).
 *
 * Computed style, with the page's own CSS: every radio on the gift tags page stays clear of the 44px floor and the box
 * look, while a typing box on the same page still gets them (the control: the rule parsed and still applies). Red on
 * the old rule ("design ... min-height 44px").
 *
 * @mutate src/pages/info/giftGuides/fun/FunPage.tsx | .gg-fun input:where(:not([type=radio],[type=checkbox])),.gg-fun select{min-height:44px; | .gg-fun input,.gg-fun select{min-height:44px;
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, isReady: true }) }));

import Printables from "@/pages/info/giftGuides/printables/Printables";

afterEach(() => act(() => cleanup()));

describe("the gift tags maker's radios keep their own size", () => {
  it("no radio on the page takes the typing boxes' 44px floor, padding or border; the label is the 44px target", async () => {
    let container!: HTMLElement;
    await act(async () => {
      container = render(
        <MemoryRouter initialEntries={["/gift-guides/printables/gift-tags"]}>
          <Routes><Route path="/gift-guides/printables/*" element={<Printables />} /></Routes>
        </MemoryRouter>,
      ).container;
    });
    const radios = await waitFor(() => {
      const r = [...container.querySelectorAll<HTMLInputElement>('.gg-fun input[type="radio"]')];
      // The designs, the name styles and the two name modes (the sweep counted 19 on the page on 2026-11-22).
      expect(r.length).toBeGreaterThan(10);
      expect(container.querySelector("[data-printable-mode]")).not.toBeNull();
      return r;
    }, { timeout: 10000 });

    // Control: a typing box on the same page still gets the fun pages' box (the rule parsed and still applies).
    const field = container.querySelector<HTMLInputElement>(".gg-fun input[data-printable-field]")!;
    expect(field).not.toBeNull();
    expect(getComputedStyle(field).minHeight).toBe("44px");

    const bad: string[] = [];
    for (const r of radios) {
      const cs = getComputedStyle(r);
      const tag = `${r.getAttribute("data-printable-design") ?? r.getAttribute("data-printable-font") ?? r.getAttribute("data-printable-layout") ?? r.getAttribute("data-printable-mode") ?? r.name}`;
      if (cs.minHeight === "44px") bad.push(`${tag}: min-height 44px`);
      if (cs.paddingLeft === "12px") bad.push(`${tag}: padding 12px`);
      if (cs.borderRadius === "10px") bad.push(`${tag}: box border-radius`);
      // The radio's own size classes are on it; its tap target is the label it sits in.
      expect(r.className, tag).toMatch(/(^| )h-4( |$)/);
      expect(r.className, tag).toMatch(/(^| )min-h-0( |$)/);
      expect(r.closest("label"), `${tag} sits in a label`).not.toBeNull();
    }
    expect(bad).toEqual([]);
  });
});
