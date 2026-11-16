/**
 * Q1540 (owner, 2026-10-08): Home's top box was taller than Posts/Jobs/Messages'
 * (measured 74px vs 58px at 375), because its bar used bigger padding and its
 * bell alone was the 56px `icon` size. PR #2620 gave Home the tab headers'
 * padding and a 44px bell; measured equal on prod 2026-10-12 (12-69px on Home,
 * My Posts and My Jobs in e2e-journeys 38181872855).
 *
 * The class: every tab's top box (Home, Messages; My Posts / My Jobs until Q2205) wears ONE
 * padding, and Home's bell is the same 44px as the Search/Filters buttons
 * beside it. Read from source so a change to any one of them fails here.
 *
 * @mutate src/components/dashboard/DashboardTitleBar.tsx | export const TITLE_BAR_PADDING = "!py-1.5 lg:!py-2"; | export const TITLE_BAR_PADDING = "!py-2 lg:!py-2.5";
 * @mutate src/components/dashboard/DashboardTitleBar.tsx | <NotificationPanel triggerClassName="h-11 w-11" /> | <NotificationPanel />
 * @mutate src/components/messages/ConversationList.tsx | const MESSAGES_HEADER_PADDING = "!py-1.5 lg:!py-2"; | const MESSAGES_HEADER_PADDING = "!py-2 lg:!py-2.5";
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const src = (p: string) => blankComments(readFileSync(join(process.cwd(), p), "utf8"));

/** Each tab's top-box padding constant: [label, file, constant name]. */
const TABS: Array<[string, string, string]> = [
  ["Home", "src/components/dashboard/DashboardTitleBar.tsx", "TITLE_BAR_PADDING"],
  ["Messages", "src/components/messages/ConversationList.tsx", "MESSAGES_HEADER_PADDING"],
];

function constantValue(file: string, name: string): string | null {
  const m = new RegExp(`const\\s+${name}\\s*=\\s*"([^"]*)"`).exec(src(file));
  return m ? m[1] : null;
}

describe("Home's top box is the same height as Posts/Jobs/Messages (Q1540)", () => {
  it("every tab's top box reads its padding from a constant", () => {
    const found = TABS.map(([label, file, name]) => [label, constantValue(file, name)]);
    expect(found.filter(([, v]) => v === null)).toEqual([]);
    // 2 since 2026-10-19 (Q2205): My Posts / My Jobs (PostsHeader / JobsHeader) left with the old screens;
    // the Jobs section's header is the shared AppTopBar (one h-16 box in every section).
    expect(found.length).toBeGreaterThan(1);
  });

  it("Home's bar and Messages wear the same padding", () => {
    const values = new Set(TABS.map(([, file, name]) => constantValue(file, name)));
    expect([...values]).toEqual(["!py-1.5 lg:!py-2"]);
  });

  it("Home's bell is the 44px size of the buttons beside it, not the 56px icon size", () => {
    expect(src("src/components/dashboard/DashboardTitleBar.tsx")).toMatch(/<NotificationPanel triggerClassName="h-11 w-11" \/>/);
  });

  it("the guest Home's title card is the member Jobs header's (M13: one header for guests and members)", () => {
    // The guest Home only since 2026-10-19 (Q2205). M13 (owner 11-16): the guest feed in the app draws the members'
    // AppTopBar (search, then Log in / Join free), so its title card takes the member Jobs header's class (Dashboard.tsx:
    // "!overflow-visible z-10" on a phone), not the old brand row's TITLE_BAR_PADDING.
    const guest = src("src/pages/home/DashboardGuest.tsx");
    expect(guest).toMatch(/titleCardClassName="!overflow-visible z-10"/);
    expect(src("src/pages/home/Dashboard.tsx")).toContain('"!overflow-visible z-10"');
    expect(guest).not.toContain("TITLE_BAR_PADDING");
  });
});
