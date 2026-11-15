/**
 * The shop dashboard's cancel-rule section loads at its own height (prod-audit run 43691657529, 2026-11-15, page-settle
 * at 375 on /shops/dashboard: 0.051 at ~715 ms, "section.space-y-2 571→766 ↑section.space-y-2 h358 'Your cancel
 * rule…'"). A 96px bone stood in for the three-option list, so the section under it moved down 195px when the rule
 * arrived. The placeholder is now the list itself, invisible under one bone, so it is the list's height at every width
 * (jsdom has no layout: this pins the structure; the height follows from it).
 *
 * @mutate src/components/shops/ShopCancelPolicyPicker.tsx |             <RadioCardList label="Cancel rule" options={policyOptions()} value="" onChange={() => {}} /> |             <div className="h-24" />
 * @mutate src/components/shops/ShopCancelPolicyPicker.tsx |           <div className="invisible" aria-hidden> |           <div aria-hidden>
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/shops/orders", async (orig) => ({
  ...(await orig<typeof import("@/lib/shops/orders")>()),
  fetchCancelPolicy: () => new Promise(() => {}),
}));

import CancelPolicyPicker from "./ShopCancelPolicyPicker";
import { CANCEL_POLICIES } from "@/lib/shops/orders";

describe("the cancel rule's loading frame is the list's own shape (Q1816)", () => {
  it("draws the real list, invisible and hidden from readers, under one bone", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><CancelPolicyPicker shopId="shop-1" /></QueryClientProvider>);
    const frame = document.querySelector<HTMLElement>("[data-cancel-rule-loading]");
    expect(frame).not.toBeNull();
    const ghost = frame!.querySelector<HTMLElement>(".invisible");
    expect(ghost).not.toBeNull();
    expect(ghost!.getAttribute("aria-hidden")).toBe("true");
    // One option per preset, the same count the loaded list draws.
    expect(CANCEL_POLICIES.length).toBeGreaterThan(1);
    expect(ghost!.querySelectorAll("[role='radio']").length).toBe(CANCEL_POLICIES.length);
    // Not announced as a choice while it loads.
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });
});
