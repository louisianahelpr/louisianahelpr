/**
 * SS-5 (saved audit 10-30): a hearted Declutter item can be found again. Buying lists "Watching" (each row opens its
 * item page), and a new heart's toast says where it went, with a way there.
 *
 * @mutate src/components/declutter/DeclutterMineViews.tsx |       <WatchingList /> |       {null}
 * A3-98 (audit 7, 11-01): one word, "Save", for keeping something for later in both sections (Jobs' "Save job").
 * @mutate src/components/declutter/DeclutterWatching.tsx | <h2 className="text-base font-semibold">Saved</h2> | <h2 className="text-base font-semibold">Watching</h2>
 * @mutate src/components/declutter/DeclutterWatching.tsx | aria-label="Saved" data-watching="" | aria-label="Watching" data-watching=""
 * @mutate src/components/declutter/declutterLightActions.ts | Find it under Buying, in Saved. | Find it under Buying, in Watching.
 * @mutate src/components/declutter/DeclutterItemCard.tsx | : `Save ${item.title}`} | : `Watch ${item.title}`}
 * @mutate src/components/declutter/DeclutterItemView.tsx | : "Save this item"} | : "Watch this item"}
 * @mutate src/components/declutter/DeclutterWatching.tsx |   if (item.status === "reserved") return "On hold for another buyer"; |   if (item.status === "reserved") return "No longer for sale";
 * @mutate src/components/declutter/DeclutterWatching.tsx |   const gone = goneLine(list.length - rows.length); |   const gone = null;
 * @mutate src/components/declutter/DeclutterItemView.tsx |       if (!isWatching) toastWatching(navigate); |       if (isWatching) toastWatching(navigate);
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |       if (on) toastWatching(navigate); |       if (!on) toastWatching(navigate);
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "@/test/helpers/blankNonCode";

const state = { ids: new Set<string>(), items: [] as unknown[], toasts: [] as unknown[][] };

vi.mock("sonner", () => ({ toast: Object.assign((...a: unknown[]) => { state.toasts.push(a); }, { error: vi.fn() }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/declutter/api", () => ({
  fetchWatching: async () => state.ids,
  fetchWatchedItems: async () => state.items,
}));

import { WatchingList, goneLine, watchedLine } from "./DeclutterWatching";
import { toastWatching } from "./declutterLightActions";

const item = (id: string, title: string, status: string, cents: number) => ({ id, title, status, current_price_cents: cents });

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><WatchingList /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  state.ids = new Set(["a", "b", "c", "d"]);
  state.items = [item("b", "Oak dresser", "reserved", 4000), item("a", "Blue lamp", "live", 1999), item("c", "Free crib", "live", 0)];
  state.toasts = [];
});

describe("Watching under Buying (SS-5)", () => {
  it("lists every hearted item, live first, each opening its item page, and counts the ones no longer listed", async () => {
    show();
    const section = await screen.findByRole("region", { name: "Saved" });
    expect(within(section).getByRole("heading", { name: "Saved" })).toBeInTheDocument();
    const rows = within(section).getAllByRole("link");
    expect(rows.length).toBeGreaterThan(2);
    expect(rows.map((r) => r.getAttribute("href"))).toEqual(["/declutter/item/a", "/declutter/item/c", "/declutter/item/b"]);
    expect(rows[0]).toHaveTextContent("Blue lamp$19.99");
    expect(rows[1]).toHaveTextContent("Free crib" + "Free");
    expect(rows[2]).toHaveTextContent("Oak dresserOn hold for another buyer");
    expect(within(section).getByText("1 item you saved is no longer listed.")).toBeInTheDocument();
  });

  it("shows nothing with no hearts", async () => {
    state.ids = new Set();
    const { container } = show();
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });

  it("row words and the gone line", () => {
    expect(watchedLine({ status: "sold", current_price_cents: 500 })).toBe("No longer for sale");
    expect(goneLine(0)).toBeNull();
    expect(goneLine(2)).toBe("2 items you saved are no longer listed.");
  });

  it("the toast says where the item went and opens Buying", () => {
    const go = vi.fn();
    toastWatching(go);
    expect(state.toasts[0][0]).toBe("Saved. Find it under Buying, in Saved.");
    const opts = state.toasts[0][1] as { action: { label: string; onClick: () => void } };
    expect(opts.action.label).toBe("See it");
    opts.action.onClick();
    expect(go).toHaveBeenCalledWith("/declutter?tab=buying");
  });

  it("Buying shows the list, and a heart turned ON (item page and Browse) shows the toast", () => {
    const mine = blankComments(readFileSync("src/components/declutter/DeclutterMineViews.tsx", "utf8"));
    expect(mine).toContain("<WatchingList />");
    const page = blankComments(readFileSync("src/components/declutter/DeclutterItemView.tsx", "utf8"));
    expect(page).toContain("if (!isWatching) toastWatching(navigate);");
    const browse = blankComments(readFileSync("src/components/declutter/DeclutterBrowseView.tsx", "utf8"));
    expect(browse).toContain("if (on) toastWatching(navigate);");
  });
});
