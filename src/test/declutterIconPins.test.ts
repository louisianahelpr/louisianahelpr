/**
 * Q2707/Q2708 (Builder 3, 11-05): the guest first screens' icons and the Declutter first screen's icons are pinned to
 * their own chunks (vite.config.ts icons-guest, icons-guest-shared, icons-declutter; bootReach.mjs guestIconSplit).
 * Left to the entriesAware icon merge, one unrelated import change (the item page dropping the times editor) regrouped
 * them: / 244 -> 251 KB gz, /signup 252 -> 266, and with one guest pin /declutter fetched all 73 guest icons plus two
 * 77-icon merged chunks (465 -> 468). Pinned (critical-path.mjs, real env): / 230, /declutter 455, item 401.
 *
 * The split must cover the guest set exactly (shared + own = guest, disjoint), the Declutter rest must not overlap
 * it, and vite.config must route each set to its named group.
 * @mutate scripts/perf/bootReach.mjs | const shared = new Set([...guest].filter((i) => drawn.has(i))); | const shared = new Set([...guest].filter((i) => !drawn.has(i)));
 * @mutate scripts/perf/bootReach.mjs | declutter: new Set([...drawn].filter((i) => !taken.has(i))) | declutter: new Set([...drawn])
 * @mutate vite.config.ts | name: "icons-declutter", | name: "icons-declutter-off", test: () => false, _was:
 * @mutate vite.config.ts | && guestSharedIcons.has(id | && guestIcons.has(id
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { guestIconFiles, guestIconSplit } from "../../scripts/perf/bootReach.mjs";

const ROOT = resolve(__dirname, "../..");

describe("Declutter and guest icon pins (Q2707/Q2708)", () => {
  const guest = guestIconFiles(ROOT);
  const { shared, own, declutter } = guestIconSplit(ROOT);

  it("splits the guest icons exactly in two, and the Declutter rest is not a guest icon", () => {
    expect(guest.size).toBeGreaterThan(40);
    expect(shared.size).toBeGreaterThan(20);
    expect(own.size).toBeGreaterThan(5);
    expect(declutter.size).toBeGreaterThan(0);
    expect([...shared].filter((i) => own.has(i))).toEqual([]);
    expect(new Set([...shared, ...own])).toEqual(guest);
    expect([...declutter].filter((i) => guest.has(i))).toEqual([]);
  });

  it("vite.config routes each set to its own pinned group", () => {
    const cfg = blankComments(readFileSync(resolve(ROOT, "vite.config.ts"), "utf8"));
    expect(cfg).toMatch(/const \{ own: guestIcons, shared: guestSharedIcons, declutter: declutterIcons \} = guestIconSplit\(/);
    for (const [name, set] of [["icons-guest", "guestIcons"], ["icons-guest-shared", "guestSharedIcons"], ["icons-declutter", "declutterIcons"]]) {
      const at = cfg.indexOf(`name: "${name}",`);
      expect(at, name).toBeGreaterThan(-1);
      const block = cfg.slice(at, cfg.indexOf("}", at));
      expect(block, name).toContain(`&& ${set}.has(id`);
      expect(block, name).toContain("includeDependenciesRecursively: false");
    }
  });
});
