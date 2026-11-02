/**
 * The bundle discount control.
 *
 * NIGHT-SET-Declutterse-2 (audit 1030 night, set-full-375-24-bundle-off): with a bundle discount saved at 10%,
 * picking Off left every choice unselected (Off checked only `chosen === null`, the press set 0). Off is the one shown,
 * and choosing it saves Off (null).
 *
 * LEAD-BUNDLE-DROPDOWN (owner 2026-10-31): one row, the label and a native dropdown (the free-after row's look), the
 * line "Applies to all your listings", in Listing defaults directly under the free-after row, in its own panel.
 *
 * A3-91 (audit 11-01, Low): it saved the moment it changed, inside the one card whose other fields wait for Save, and
 * nothing on screen said which was which. Every other Selling setting saves with its card's Save (places, meetup times,
 * delivery, listing defaults), so the bundle discount now does too: a change shows "Not saved yet", and Save writes it.
 * Red on main: the change saved at once, with no Save.
 *
 * @mutate src/components/declutter/BundleDiscountCard.tsx |           onChange={(e) => onPick(e.target.value === "off" ? null : Number(e.target.value))} |           onChange={(e) => onPick(Number(e.target.value))}
 * @mutate src/components/declutter/BundleDiscountCard.tsx | {BUNDLE_APPLIES_LINE}. | Applies to your next listing.
 * @mutate src/components/declutter/DeclutterListingDefaults.tsx |   const unsaved = !same(draft, base) \|\| bundleDirty; |   const unsaved = !same(draft, base);
 * @mutate src/components/declutter/DeclutterListingDefaults.tsx |       if (done && bundleDirty) { |       if (false) {
 * @mutate src/components/declutter/DeclutterListingDefaults.tsx |       if (bundleError !== undefined) { |       if (false) {
 * @mutate src/components/declutter/DeclutterListingDefaults.tsx |       <ListingChoiceFields draft={draft} change={change} />\n |       <ListingChoiceFields draft={draft} change={change} />\n      <hr />\n
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { blankComments } from "@/test/helpers/blankNonCode";
import type { SellerDefaults } from "@/lib/declutter/sellerDefaults";

const state = vi.hoisted(() => ({ bundle: 10 as number | null, bundleSaves: [] as (number | null)[], bundleFails: false, defaultsSaves: 0 }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: (k: string) => k === "declutter", useFeatureStatus: (k: string) => ({ on: k === "declutter", settled: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: {}, isLoading: false }) }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
vi.mock("@/lib/declutter/sellerDefaults", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/sellerDefaults")>()),
  fetchSellerDefaults: async () => null,
  saveSellerDefaults: async (_u: string, _d: SellerDefaults) => {
    state.defaultsSaves++;
    return true;
  },
}));
vi.mock("@/lib/declutter/bundle", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/bundle")>()),
  BUNDLE_PERCENTS: [5, 10, 15],
  fetchBundleRule: async () => state.bundle,
  setBundleDiscount: async (p: number | null) => {
    if (state.bundleFails) throw Object.assign(new Error("boom"), { userMessage: "We couldn't save your bundle discount." });
    state.bundleSaves.push(p);
    state.bundle = p;
    return p;
  },
}));
vi.mock("@/lib/declutter/bundleErrors", () => ({ bundleErrorMessage: () => "We couldn't save your bundle discount." }));
vi.mock("@/lib/declutter/api", async (orig) => ({ ...(await orig<typeof import("@/lib/declutter/api")>()), fetchMyPickupWindows: async () => [], fetchMyItems: async () => [] }));
vi.mock("@/lib/declutter/porchPlaces", async (orig) => ({ ...(await orig<typeof import("@/lib/declutter/porchPlaces")>()), fetchMyPorchPlaces: async () => [] }));

import { ListingDefaultsCard } from "./DeclutterListingDefaults";

function open() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><ListingDefaultsCard userId="u1" /></MemoryRouter>
    </QueryClientProvider>,
  );
}
const select = () => screen.findByRole("combobox", { name: "Bundle discount" });

beforeEach(() => {
  state.bundle = 10;
  state.bundleSaves = [];
  state.bundleFails = false;
  state.defaultsSaves = 0;
  vi.mocked(toast).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe("Bundle discount: one dropdown row that saves with Listing defaults' Save (A3-91)", () => {
  it("saved at 10%: shows it; choosing Off waits for Save ('Not saved yet'), then Save writes Off", async () => {
    open();
    await waitFor(async () => expect(await select()).toHaveValue("10"));
    expect(screen.getByText(/^Applies to all your listings/)).toBeInTheDocument();
    const saveBtn = screen.getByRole("button", { name: "Save" });
    expect(saveBtn).toBeDisabled();
    fireEvent.change(await select(), { target: { value: "off" } });
    expect(await select()).toHaveValue("off");
    await new Promise((r) => setTimeout(r, 20));
    expect(state.bundleSaves).toEqual([]);
    expect(screen.getByText("Not saved yet. Tap Save to keep these.")).toBeInTheDocument();
    expect(saveBtn).toBeEnabled();
    fireEvent.click(saveBtn);
    await waitFor(() => expect(state.bundleSaves).toEqual([null]));
    await waitFor(() => expect(screen.queryByText("Not saved yet. Tap Save to keep these.")).toBeNull());
    expect(await select()).toHaveValue("off");
    expect(state.defaultsSaves).toBe(1);
  });

  it("picking back the saved value leaves nothing to save", async () => {
    open();
    await waitFor(async () => expect(await select()).toHaveValue("10"));
    fireEvent.change(await select(), { target: { value: "15" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    fireEvent.change(await select(), { target: { value: "10" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("a bundle save that fails says so and keeps the pick to try again", async () => {
    state.bundleFails = true;
    open();
    await waitFor(async () => expect(await select()).toHaveValue("10"));
    fireEvent.change(await select(), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("We couldn't save your bundle discount."));
    expect(await select()).toHaveValue("15");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("sits in Listing defaults directly under the free-after row, never back in its own settings section", () => {
    // blankComments keeps a JSX comment's braces: drop the empty {} it leaves.
    const defaults = blankComments(readFileSync("src/components/declutter/DeclutterListingDefaults.tsx", "utf8")).replace(/\{\s*\}/g, "");
    expect(defaults).toMatch(/<ListingChoiceFields draft=\{draft\} change=\{change\} \/>\s*<BundleDiscountCard pick=\{bundlePick\} /);
    // ListingChoiceFields ends with the free-after row, so the bundle row is the next thing under it.
    const fields = defaults.slice(defaults.indexOf("export function ListingChoiceFields"), defaults.indexOf("function ListingDefaultsForm"));
    expect(fields.trimEnd()).toMatch(/<AutoFreeChoice [^\n]*\/>\s*<\/>\);\s*\}$/);
    const page = blankComments(readFileSync("src/pages/declutter/DeclutterSettingsPage.tsx", "utf8"));
    expect(page).not.toContain("BundleDiscountCard");
  });
});
