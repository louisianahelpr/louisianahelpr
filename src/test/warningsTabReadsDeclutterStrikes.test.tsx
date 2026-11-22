/**
 * CLASS GUARD (deep audit 1122 #136): one strikes source for the account's Warnings tab and Declutter.
 *
 * WHAT WAS BROKEN: helpr-e2e-helper had one live row in declutter_strikes. Every Declutter tab said "You have 1 of 3
 * strikes", while /profile?tab=warnings said "Good standing. No warnings or violations on record. 0 of 3 strikes":
 * the Warnings tab read only `violations` and never Declutter's strikes.
 *
 * WHAT THIS PINS
 *   1. Inventory from source: every read of declutter_strikes in src/ (outside admin) lives in
 *      src/lib/declutter/strikes.ts, Declutter's count (fetchMyActiveStrikes) is derived from the same reader the
 *      Warnings tab uses (fetchMyActiveStrikeEnds), and the Warnings tab imports it.
 *   2. Rendered: with one live Declutter strike and no account violations, the Warnings tab shows
 *      "Declutter: 1 of 3 strikes" with the day it goes away, and never "No warnings or violations on record".
 */
// @mutate src/components/profile/WarningsTab.tsx |           {declutterStrikeEnds.length > 0 && ( |           {false && (
// @mutate src/components/profile/WarningsTab.tsx | declutterStrikeEnds.length > 0 ? t("acct.goodBodyDeclutter") : t("acct.goodBody") | t("acct.goodBody")
import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { trackedFiles } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: null }) }));
const ends = vi.hoisted(() => ({ value: [] as string[] }));
vi.mock("@/lib/declutter/strikes", () => ({
  fetchMyActiveStrikeEnds: vi.fn(async () => ends.value),
  fetchMyActiveStrikes: vi.fn(async () => ends.value.length),
}));

import { WarningsTab } from "@/components/profile/WarningsTab";

afterEach(() => cleanup());

function renderTab() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <WarningsTab violations={[]} loading={false} onBack={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("the Warnings tab and Declutter read one strikes source (deep audit 1122 #136)", () => {
  it("every declutter_strikes read in the app is the one shared reader", () => {
    const readers = trackedFiles("src")
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith("src/test/") && !f.startsWith("src/integrations/"))
      .filter((f) => !/\/admin\//i.test(f))
      .filter((f) => /\.from\(\s*["']declutter_strikes["']\s*\)/.test(blankComments(readFileSync(f, "utf8"))));
    expect(readers).toEqual(["src/lib/declutter/strikes.ts"]);
    const strikes = blankComments(readFileSync("src/lib/declutter/strikes.ts", "utf8"));
    expect(strikes).toMatch(/fetchMyActiveStrikes\([^)]*\)[^{]*\{\s*return \(await fetchMyActiveStrikeEnds\(/);
    const tab = blankComments(readFileSync("src/components/profile/WarningsTab.tsx", "utf8"));
    expect(tab).toContain('from "@/lib/declutter/strikes"');
    expect(tab).toContain("fetchMyActiveStrikeEnds(");
  });

  it("one live Declutter strike shows on the Warnings tab, and the all-clear sentence does not", async () => {
    ends.value = ["2027-06-01T12:00:00Z"];
    renderTab();
    expect(await screen.findByText("Declutter: 1 of 3 strikes")).toBeTruthy();
    expect(screen.getByText(/The next one goes away Jun 1, 2027\./)).toBeTruthy();
    expect(screen.queryByText("No warnings or violations on record.")).toBeNull();
  });

  it("no Declutter strikes: the all-clear stands and no Declutter row shows", async () => {
    ends.value = [];
    renderTab();
    expect(await screen.findByText("No warnings or violations on record.")).toBeTruthy();
    expect(document.querySelector("[data-declutter-strikes]")).toBeNull();
  });
});
