/**
 * Q1540 (owner, 2026-10-08): Home's top box was taller than Posts/Jobs/Messages'
 * (measured 74px vs 58px at 375), because its bar used bigger padding and its
 * bell alone was the 56px `icon` size. PR #2620 gave Home the tab headers'
 * padding and a 44px bell; measured equal on prod 2026-10-12 (12-69px on Home,
 * My Posts and My Jobs in e2e-journeys 38181872855).
 *
 * The class: every tab's top box (Home, My Posts, My Jobs, Messages) wears ONE
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
  ["My Posts", "src/pages/posts/PostsHeader.tsx", "POSTS_HEADER_PADDING"],
  ["My Jobs", "src/pages/jobs/JobsHeader.tsx", "JOBS_HEADER_PADDING"],
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
    expect(found.length).toBeGreaterThan(3);
  });

  it("all four tabs wear the same padding", () => {
    const values = new Set(TABS.map(([, file, name]) => constantValue(file, name)));
    expect([...values]).toEqual(["!py-1.5 lg:!py-2"]);
  });

  it("Home's bell is the 44px size of the buttons beside it, not the 56px icon size", () => {
    expect(src("src/components/dashboard/DashboardTitleBar.tsx")).toMatch(/<NotificationPanel triggerClassName="h-11 w-11" \/>/);
  });

  it("Home and the guest Home pass the shared padding to their title card", () => {
    for (const f of ["src/pages/home/Dashboard.tsx", "src/pages/home/DashboardGuest.tsx"]) {
      expect(src(f), f).toMatch(/titleCardClassName=\{TITLE_BAR_PADDING\}/);
    }
  });
});
