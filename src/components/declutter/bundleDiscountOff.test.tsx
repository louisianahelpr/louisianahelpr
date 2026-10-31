/**
 * The bundle discount control.
 *
 * NIGHT-SET-Declutterse-2 (audit 1030 night, set-full-375-24-bundle-off): with a bundle discount saved at 10%,
 * picking Off left every choice unselected (Off checked only `chosen === null`, the press set 0). Off is the one shown,
 * and choosing it saves Off (null).
 *
 * LEAD-BUNDLE-DROPDOWN (owner 2026-10-31; lead's call): one row, the label and a native dropdown (the free-after row's
 * look), saved the moment it changes with "Saved" said in place (no separate Save button), the line "Applies to all
 * your listings", and it sits in Listing defaults directly under the free-after row, in its own panel. Red on
 * cb20b3f6b1: a collapsed card in "Delivery and bundles" with chips and a Save button.
 *
 * @mutate src/components/declutter/BundleDiscountCard.tsx |             const next = e.target.value === "off" ? null : Number(e.target.value); |             const next = Number(e.target.value);
 * @mutate src/components/declutter/BundleDiscountCard.tsx |             if (next !== current) save.mutate(next); |             void next;
 * @mutate src/components/declutter/BundleDiscountCard.tsx |       setSaved(true); |       setSaved(false);
 * @mutate src/components/declutter/BundleDiscountCard.tsx | {BUNDLE_APPLIES_LINE}. | Applies to your next listing.
 * @mutate src/components/declutter/DeclutterListingDefaults.tsx |       <ListingChoiceFields draft={draft} change={change} />\n |       <ListingChoiceFields draft={draft} change={change} />\n      <hr />\n
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { blankComments } from "@/test/helpers/blankNonCode";

const saved: (number | null)[] = [];
const rule = { value: 10 as number | null };
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/declutter/bundle", () => ({
  BUNDLE_PERCENTS: [5, 10, 15],
  bundleLabel: (p: number) => `Buy 2+, get ${p}% off`,
  fetchBundleRule: async () => rule.value,
  setBundleDiscount: async (p: number | null) => {
    saved.push(p);
    rule.value = p;
    return p;
  },
}));

import { BundleDiscountCard } from "./BundleDiscountCard";

describe("Bundle discount: one dropdown row that saves on change", () => {
  it("saved at 10%: the dropdown shows it; choosing Off saves Off at once and says Saved; no Save button", async () => {
    saved.length = 0;
    rule.value = 10;
    render(<QueryClientProvider client={new QueryClient()}><BundleDiscountCard /></QueryClientProvider>);
    const select = await screen.findByRole("combobox", { name: "Bundle discount" });
    await waitFor(() => expect(select).toHaveValue("10"));
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByText(/^Applies to all your listings/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("");
    fireEvent.change(select, { target: { value: "off" } });
    await waitFor(() => expect(saved).toEqual([null]));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved"));
    expect(screen.getByRole("combobox", { name: "Bundle discount" })).toHaveValue("off");
    fireEvent.change(screen.getByRole("combobox", { name: "Bundle discount" }), { target: { value: "15" } });
    await waitFor(() => expect(saved).toEqual([null, 15]));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Bundle discount" })).toHaveValue("15"));
  });

  it("sits in Listing defaults directly under the free-after row, never back in its own settings section", () => {
    // blankComments keeps a JSX comment's braces: drop the empty {} it leaves.
    const defaults = blankComments(readFileSync("src/components/declutter/DeclutterListingDefaults.tsx", "utf8")).replace(/\{\s*\}/g, "");
    expect(defaults).toMatch(/<ListingChoiceFields draft=\{draft\} change=\{change\} \/>\s*<BundleDiscountCard \/>/);
    // ListingChoiceFields ends with the free-after row, so the bundle row is the next thing under it.
    const fields = defaults.slice(defaults.indexOf("export function ListingChoiceFields"), defaults.indexOf("function ListingDefaultsForm"));
    expect(fields.trimEnd()).toMatch(/<AutoFreeChoice [^\n]*\/>\s*<\/>\);\s*\}$/);
    const page = blankComments(readFileSync("src/pages/declutter/DeclutterSettingsPage.tsx", "utf8"));
    expect(page).not.toContain("BundleDiscountCard");
  });
});
