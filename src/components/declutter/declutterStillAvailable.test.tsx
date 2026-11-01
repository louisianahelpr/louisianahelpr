/**
 * The free listing "still available?" sheet (owner's choice, 2026-10-30), opened by the notice's link.
 *
 * @mutate src/components/declutter/DeclutterStillAvailable.tsx |     if (item?.status === "live" && item.current_price_cents === 0) setAsking(item); |     if (item) setAsking(item);
 * @mutate src/components/declutter/DeclutterStillAvailable.tsx | await (gone ? markSoldElsewhere(id) : markStillAvailable(id)); | await markStillAvailable(id);
 * @mutate src/components/declutter/DeclutterStillAvailable.tsx |       next.delete("still"); |
 * @mutate src/components/declutter/DeclutterHomeView.tsx |       <StillAvailableSheet items={mine.data} /> |
 * @mutate src/components/declutter/DeclutterStillAvailable.tsx |       toast(gone ? "Thanks. | toast.success(gone ? "Thanks.
 */
import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StillAvailableSheet } from "./DeclutterStillAvailable";
import type { DeclutterItem } from "@/lib/declutter/api";

const calls = vi.hoisted(() => ({ list: [] as unknown[][] }));
vi.mock("@/lib/declutter/api", () => ({
  markSoldElsewhere: async (id: string) => { calls.list.push(["gone", id]); },
  markStillAvailable: async (id: string) => { calls.list.push(["still", id]); return "still_available"; },
}));

const ID = "a0000000-0000-4000-8000-000000000001";
const item = (over: Partial<DeclutterItem> = {}) => ({ id: ID, title: "Free moving boxes", status: "live", current_price_cents: 0, ...over }) as DeclutterItem;

function Where() {
  return <p data-testid="where">{useLocation().search}</p>;
}
const renderIt = (items: DeclutterItem[] | undefined, search = `?tab=selling&still=${ID}`) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[`/declutter${search}`]}>
        <StillAvailableSheet items={items} />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => { calls.list = []; });

describe("StillAvailableSheet", () => {
  it("the link opens it for a live free listing and clears itself from the address", async () => {
    renderIt([item()]);
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Free moving boxes")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("?tab=selling"));
  });

  it("Still available is one tap and ends nothing", async () => {
    renderIt([item()]);
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Still available" }));
    await waitFor(() => expect(calls.list).toEqual([["still", ID]]));
  });

  it("It's gone is one tap and ends the listing", async () => {
    renderIt([item()]);
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "It's gone" }));
    await waitFor(() => expect(calls.list).toEqual([["gone", ID]]));
  });

  it.each([["a reserved listing", { status: "reserved" }], ["a priced listing", { current_price_cents: 500 }]] as const)("%s doesn't ask", async (_name, over) => {
    renderIt([item(over as Partial<DeclutterItem>)]);
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("?tab=selling"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the thanks is shown: toastPolicy suppresses toast.success, the bare toast() renders", () => {
    const src = readFileSync("src/components/declutter/DeclutterStillAvailable.tsx", "utf8");
    // Floor (vacuity scan): the real sheet was read (3.2 KB on 10-31).
    expect(src.length).toBeGreaterThan(1_000);
    expect(src).toMatch(/\btoast\(gone \? "Thanks\./);
  });

  it("the selling screen mounts it", () => {
    expect(readFileSync("src/components/declutter/DeclutterHomeView.tsx", "utf8")).toContain("<StillAvailableSheet items={mine.data} />");
  });
});
