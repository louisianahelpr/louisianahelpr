/**
 * Owner, 2026-10-08 (Q1560): "Pull to refresh is not the same for home as it is
 * for post or jobs". Home never passed `canTrigger`, so its indicator never
 * reached the "release to refresh" state the other three draw.
 *
 * The class: every page that mounts PullToRefreshWrapper hands it the hook's
 * canTrigger, so the gesture reads the same on every page.
 *
 * @mutate src/components/dashboard/BrowseTasksFeed.tsx |         canTrigger={canTrigger} |
 *
 * And Messages' EMPTY inbox sat outside its pull area, so pulling an empty
 * inbox in the app did nothing (owner: "why doesn't messages refresh in the app
 * like the other pages").
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const files = execSync("git ls-files 'src/**/*.tsx'", { encoding: "utf8" })
  .split("\n")
  .filter((f) => f && !f.includes(".test.") && f !== "src/components/PullToRefreshWrapper.tsx");

describe("every pull-to-refresh draws the same states", () => {
  const mounts = files.filter((f) => /<PullToRefreshWrapper\b/.test(readFileSync(join(process.cwd(), f), "utf8")));
  it("finds the mounts (inventory floor: Home, Posts/Jobs, Messages)", () => {
    expect(mounts.length).toBeGreaterThanOrEqual(3);
  });
  it("each passes canTrigger", () => {
    const missing = mounts.filter((f) => {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      const tag = src.slice(src.indexOf("<PullToRefreshWrapper"), src.indexOf(">", src.indexOf("isPulling=", src.indexOf("<PullToRefreshWrapper"))) + 1);
      return !/canTrigger=/.test(tag);
    });
    expect(missing).toEqual([]);
  });
  it("Messages' empty inbox is inside the pull area", () => {
    const s = readFileSync(join(process.cwd(), "src/components/messages/ConversationList.tsx"), "utf8");
    const at = s.indexOf('title="No messages yet"');
    const before = s.slice(0, at);
    expect(before.lastIndexOf("<PullToRefreshWrapper")).toBeGreaterThan(before.lastIndexOf("</PullToRefreshWrapper>"));
  });
});
