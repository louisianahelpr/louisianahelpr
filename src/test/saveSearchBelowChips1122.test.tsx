/**
 * Deep audit 11-22 #29 (Medium): on /jobs Browse at 375, after typing a search, "Save this search" was drawn under the
 * category chip row and could not be tapped (measured locally: button top 111 inside the chips' band, elementFromPoint
 * hit a chip's icon). Jobs' tabs and chips overlay the list's top on a phone (ScrollAway.tsx) and only the list
 * reserves their height (ScrollAwaySpacer), so anything the toolbar draws between them sits under the chips.
 *
 * The row is now ONE component (JobsSaveSearchRow) drawn in two places that never both show: the toolbar while the
 * chips do not overlay, the list (right after the spacer) while they do.
 *
 * @mutate src/components/dashboard/JobsSaveSearchRow.tsx |   if ((place === "list") !== overlay) return null; |   if (place === "list") return null;
 * @mutate src/components/dashboard/BrowseTasksFeed.tsx | <><ScrollAwaySpacer /><JobsSaveSearchRow filters={filters} user={user} place="list" /></> | <ScrollAwaySpacer />
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import type { User } from "@supabase/supabase-js";
import { ScrollAwayContext, type Scope } from "@/components/sections/ScrollAwayScope";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
vi.mock("@/components/savedSearches/SaveSearchButton", () => ({ SaveSearchButton: () => <button type="button">Save this search</button> }));

import { JobsSaveSearchRow } from "@/components/dashboard/JobsSaveSearchRow";

const user = { id: "u1" } as User;
const filters = { searchQuery: "yard", selectedCategory: null, minBudget: "", maxBudget: "", nearbyMiles: null, nearbyUnavailable: false } as unknown as Parameters<typeof JobsSaveSearchRow>[0]["filters"];
const scope = (overlay: boolean): Scope => ({
  rows: overlay, setRows: () => {}, spacer: overlay ? document.createElement("div") : null, setSpacer: () => {}, height: overlay ? 92 : 0, setHeight: () => {},
});
const both = (overlay: boolean) => render(
  <ScrollAwayContext.Provider value={scope(overlay)}>
    <JobsSaveSearchRow filters={filters} user={user} place="toolbar" />
    <JobsSaveSearchRow filters={filters} user={user} place="list" />
  </ScrollAwayContext.Provider>,
);

afterEach(cleanup);

describe("Save this search never sits under Jobs' chips (deep audit 11-22 #29)", () => {
  it("phone (chips overlay the list): only the list copy draws, after the spacer", async () => {
    both(true);
    expect(await screen.findByRole("button", { name: "Save this search" })).toBeTruthy();
    expect(document.querySelectorAll("[data-jobs-save-search]")).toHaveLength(1);
    expect(document.querySelector('[data-jobs-save-search="list"]')).not.toBeNull();
  });

  it("desktop or map (no overlay): only the toolbar copy draws", async () => {
    both(false);
    expect(await screen.findByRole("button", { name: "Save this search" })).toBeTruthy();
    expect(document.querySelectorAll("[data-jobs-save-search]")).toHaveLength(1);
    expect(document.querySelector('[data-jobs-save-search="toolbar"]')).not.toBeNull();
  });

  it("the feed draws the list copy right after the spacer; the toolbar draws only the toolbar copy", () => {
    const feed = blankComments(readFileSync("src/components/dashboard/BrowseTasksFeed.tsx", "utf8"));
    expect(feed).toContain('<><ScrollAwaySpacer /><JobsSaveSearchRow filters={filters} user={user} place="list" /></>');
    const toolbar = blankComments(readFileSync("src/components/dashboard/BrowseTasksToolbar.tsx", "utf8"));
    expect(toolbar).toContain('<JobsSaveSearchRow filters={filters} user={user} place="toolbar" />');
    expect(toolbar).not.toMatch(/<SaveSearchButton\b/);
  });
});
