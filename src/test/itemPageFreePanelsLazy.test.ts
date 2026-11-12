/**
 * Q178 (Builder 2, 2026-11-11): the free-item panels (DeclutterFreeClaim.tsx: the claim panel and the giver's asks) load
 * only on a free listing. Statically imported, every paid item page's first load carried them (item 420 -> 414 KB gz,
 * vite build + critical-path.mjs, 2026-11-11), with the budget's 420 limit reached. isFreeItem lives in freeItem.ts.
 *
 * @mutate src/components/declutter/DeclutterItemView.tsx | import { isFreeItem } from "./freeItem"; | import { isFreeItem } from "./freeItem"; import "./DeclutterFreeClaim";
 */
import { describe, it, expect } from "vitest";
import { relative, resolve } from "node:path";
import { staticReach } from "../../scripts/perf/bootReach.mjs";

const ROOT = resolve(__dirname, "../..");

describe("the item page's first load carries no free-item panel code (Q178)", () => {
  it("DeclutterItemPage's static closure leaves DeclutterFreeClaim.tsx out", () => {
    const reach = [...staticReach(ROOT, [resolve(ROOT, "src/pages/declutter/DeclutterItemPage.tsx")])].map((f) => relative(ROOT, f).split("\\").join("/"));
    // Floor: the walk really reaches the item view.
    expect(reach).toContain("src/components/declutter/DeclutterItemView.tsx");
    expect(reach.length).toBeGreaterThan(50);
    expect(reach).toContain("src/components/declutter/freeItem.ts");
    expect(reach).not.toContain("src/components/declutter/DeclutterFreeClaim.tsx");
  });
});
