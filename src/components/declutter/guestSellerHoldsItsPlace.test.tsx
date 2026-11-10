/**
 * Item page speed (lead 11-09; owner rule: zero layout shift). A guest's seller line ("Sold by Dana") arrived ~6.5 s
 * into a Slow 4G item page with nothing holding its place, so the description below it dropped 86 px (cwv-lab 375,
 * chromium, 3 runs: CLS 0.0192 on every guest item page). While the name loads, the row's own box now stands in: the
 * same border, padding and 40 px avatar line, so the same height.
 *
 * @mutate src/components/declutter/DeclutterGuest.tsx |   if (first.isLoading) { |   if (first.isLoading && false) {
 * @mutate src/components/declutter/DeclutterGuest.tsx |         <Skeleton className="h-10 w-10 shrink-0 rounded-full" /> |         <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let answer: (v: string | null) => void = () => {};
vi.mock("@/lib/declutter/api", () => ({
  fetchGuestSellerFirstName: () => new Promise<string | null>((r) => (answer = r)),
}));

import { DeclutterGuestSeller } from "./DeclutterGuest";

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DeclutterGuestSeller itemId="i-1" />
    </QueryClientProvider>,
  );

describe("a guest's seller line holds its place while the name loads (item page speed, 11-09)", () => {
  it("draws the row's own box while loading, then the row in the same box", async () => {
    show();
    const held = document.querySelector<HTMLElement>("[data-guest-seller-loading]");
    expect(held, "a placeholder while loading").not.toBeNull();
    expect(held!.getAttribute("aria-hidden")).toBe("true");
    // The avatar line sets the height: the same 40 px circle as the loaded row's initial.
    expect(held!.querySelector(":scope > [data-skeleton]")?.className).toContain("h-10 w-10");
    answer("Dana");
    const name = await screen.findByText("Dana");
    const row = name.closest<HTMLElement>("[data-guest-seller]")!;
    expect(row.className, "the same box").toBe(held!.className);
    expect(row.querySelector(":scope > span")?.className).toContain("h-10 w-10");
    expect(document.querySelector("[data-guest-seller-loading]")).toBeNull();
  });

  it("no name: nothing (the listing reads the same without it)", async () => {
    const { container } = show();
    answer(null);
    await vi.waitFor(() => expect(container.querySelector("[data-guest-seller-loading]")).toBeNull());
    expect(container.querySelector("[data-guest-seller]")).toBeNull();
  });
});
