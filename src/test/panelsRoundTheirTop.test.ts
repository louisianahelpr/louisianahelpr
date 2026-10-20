/**
 * Owner, 2026-10-08: "Round the top edge of filters to be like notifications".
 * Every phone screen panel (Notifications, Filters) rounds its TOP corners like
 * its bottom ones. The class: every `screenPanelContentProps(` call in src/
 * passes `roundTopCorners: true`.
 *
 * (Filters left this class 2026-10-20: board 24 made it a Sheet on every width.)
 * @mutate src/components/NotificationPanel.tsx | screenPanelContentProps(band, { roundTopCorners: true, contentMaxWidth | screenPanelContentProps(band, { contentMaxWidth
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const files = execFileSync("git", ["grep", "-l", "screenPanelContentProps(", "--", "src"], { encoding: "utf8" })
  .split("\n").filter((f) => f && !/\.test\./.test(f) && !f.endsWith("anchoredPanel.tsx"));

describe("every phone screen panel rounds its top corners", () => {
  it("finds the panels (inventory floor)", () => {
    expect(files.length).toBeGreaterThanOrEqual(1);
  });
  it.each(files)("%s passes roundTopCorners: true", (f) => {
    const calls = readFileSync(f, "utf8").match(/screenPanelContentProps\([^)]*\)/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c).toMatch(/roundTopCorners:\s*true/);
  });
});
