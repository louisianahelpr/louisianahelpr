/**
 * /admin's icons are pinned to their own chunk (Q2705 follow-up, lead 11-14; vite.config.ts icons-admin, bootReach.mjs
 * adminIconFiles). Left to the entriesAware icon merge, /admin's 25 icons rode in four merged chunks (~17.9 KB gz), and
 * an unrelated change to the entry's imports (the guest /declutter Supabase client preload) regrouped them: /admin
 * 324 -> 325 KB gz against its limit (CI-env build on main 4645718853). Pinned: /admin 313 KB gz; every other row
 * within 1 KB of main.
 *
 * The admin set must be the page's own icons only (none an earlier pin takes), and vite.config must route it to its
 * group above the merged `icons` group.
 * @mutate vite.config.ts | name: "icons-admin", | name: "icons-admin-off", test: () => false, _was:
 * @mutate scripts/perf/bootReach.mjs |   return new Set([...out].filter((i) => !taken.has(i)));\n}\n\nexport function itemIconFiles | return new Set([...out]);\n}\n\nexport function itemIconFiles
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { adminIconFiles, bootIconFiles, guestIconSplit, homeIconFiles, itemIconFiles } from "../../scripts/perf/bootReach.mjs";

const ROOT = resolve(__dirname, "../..");

describe("/admin's icon pin", () => {
  it("is Admin's own icons, none an earlier pin takes", () => {
    const admin = adminIconFiles(ROOT);
    expect(admin.size).toBeGreaterThan(10);
    const { own, shared, declutter } = guestIconSplit(ROOT);
    const taken = new Set([...bootIconFiles(ROOT), ...homeIconFiles(ROOT), ...itemIconFiles(ROOT), ...own, ...shared, ...declutter]);
    expect([...admin].filter((i) => taken.has(i))).toEqual([]);
  });

  it("vite.config routes it to its own group, ranked above the merged icons", () => {
    const cfg = blankComments(readFileSync(resolve(ROOT, "vite.config.ts"), "utf8"));
    expect(cfg).toMatch(/const adminIcons = adminIconFiles\(process\.cwd\(\)\);/);
    const at = cfg.indexOf('name: "icons-admin",');
    expect(at).toBeGreaterThan(-1);
    const block = cfg.slice(at, cfg.indexOf("}", at));
    expect(block).toContain("&& adminIcons.has(id");
    expect(block).toContain("includeDependenciesRecursively: false");
    const pr = Number(/priority: ([\d.]+)/.exec(block)?.[1]);
    const merged = cfg.slice(cfg.indexOf('name: "icons",'));
    expect(pr).toBeGreaterThan(Number(/priority: ([\d.]+)/.exec(merged)?.[1]));
  });
});
