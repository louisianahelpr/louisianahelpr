// @vitest-environment jsdom
/*
 * A SKELETON IS NEVER CONTENT (lead ruling, 2026-10-17, on the page-settle "two
 * waves" finding).
 *
 * scripts/audit/measure-page-settle.mjs counts a page's repeated items to find
 * how many waves it arrived in. ProfilePageSkeleton is DATA-AWARE: it draws the
 * real Work group (WORK_MENU_GROUP through SettingsGroup) with real text and no
 * bone inside any row, so the sampler counted those rows as the page arriving.
 * /profile then read as two waves (skeleton rows, then the page) whenever the
 * page landed more than WAVE_MERGE_MS after its skeleton: seen 1 run in 4 on
 * main, ~/.lh-shots/reds-1017/prof/.
 *
 * The sampler now skips anything inside a loading region (SKELETON_SCOPE_SEL).
 * This guard renders EVERY skeleton component the app exports (inventoried from
 * source, not listed by hand) into the sampler and requires zero items, and
 * shows on the same rows outside a skeleton that the sampler does count them.
 *
 * @mutate scripts/audit/measure-page-settle.mjs |         if (c.closest(skeletonScope)) continue; |         if (false) continue;
 * @mutate scripts/audit/measure-page-settle.mjs |   const skeletonScope = '[aria-busy="true"], [data-skeleton], [data-testid*="skeleton" i], [class*="skeleton" i]'; |   const skeletonScope = '[aria-busy="true"]';
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join, relative, resolve } from "node:path";
import type { ComponentType } from "react";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SETTLE_INIT, SKELETON_SCOPE_SEL } from "../../scripts/audit/measure-page-settle.mjs";
import { PLACEHOLDER_SEL } from "../../scripts/audit/measure-loading-states.mjs";
import { ProfilePageSkeleton } from "@/components/profile/ProfilePageSkeleton";
import { SettingsGroup } from "@/components/profile/profileLanding/SettingsSection";
import { WORK_MENU_GROUP } from "@/components/profile/profileLanding/workMenuGroup";

type Settle = { counts: { n: number; added?: string[] }[] };
const settle = () => (window as unknown as { __settle: Settle }).__settle;
const repoRoot = resolve(__dirname, "../..");

/** Mount into #root, give every element a card-sized box (jsdom lays nothing out), and take the sampler's first count. */
function itemsIn(ui: React.ReactElement): { n: number; added: string[]; text: string } {
  const root = document.createElement("div");
  root.id = "root";
  document.body.appendChild(root);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: 300, bottom: 64, width: 300, height: 64, toJSON: () => ({}),
  } as DOMRect);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
    { container: root },
  );
  vi.useFakeTimers();
  (SETTLE_INIT as (sel: string) => void)(PLACEHOLDER_SEL as string);
  const first = settle().counts[0] ?? { n: 0, added: [] };
  return { n: first.n, added: first.added ?? [], text: (root.textContent ?? "").replace(/\s+/g, " ") };
}

/** Every exported *Skeleton component under src/, from source. */
function skeletonModules(): { file: string; names: string[] }[] {
  const out: { file: string; names: string[] }[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = e.name;
      const p = join(d, f);
      if (e.isDirectory()) { walk(p); continue; }
      if (!f.endsWith(".tsx") || f.includes(".test.")) continue;
      const src = readFileSync(p, "utf8");
      const names = [...src.matchAll(/export\s+(?:const|function)\s+([A-Z][A-Za-z]*Skeleton)\b/g)].map((m) => m[1]);
      // A default export counts too (the route skeletons App.tsx lazy-loads).
      if (/export\s+default\s+(?:function\s+)?[A-Z][A-Za-z]*Skeleton\b/.test(src)) names.push("default");
      if (names.length) out.push({ file: relative(repoRoot, p), names });
    }
  };
  walk(resolve(repoRoot, "src"));
  return out;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("page-settle: a skeleton is never content", () => {
  it("the selector the sampler runs in the page is the exported one", () => {
    expect(SETTLE_INIT.toString()).toContain(SKELETON_SCOPE_SEL);
  });

  it("does NOT count ProfilePageSkeleton's real-text Work rows (the /profile two-waves finding)", () => {
    const r = itemsIn(<ProfilePageSkeleton />);
    // Non-vacuous: the skeleton really does draw the Work group's text.
    expect(r.text).toContain(WORK_MENU_GROUP.items[0].label);
    expect(r, `counted skeleton rows: ${r.added.join(" | ")}`).toMatchObject({ n: 0 });
  });

  it("DOES count the same Work rows when they are the page (the sampler is live)", () => {
    const r = itemsIn(<div className="space-y-4"><SettingsGroup group={WORK_MENU_GROUP} /></div>);
    expect(r.n).toBeGreaterThan(1);
  });

  const mods = skeletonModules();
  it("inventories the app's skeleton components from source", () => {
    expect(mods.length).toBeGreaterThan(12); // 16 skeleton modules on 2026-10-17
    expect(mods.reduce((a, m) => a + m.names.length, 0)).toBeGreaterThan(20);
  });

  for (const m of mods) {
    for (const name of m.names) {
      it(`${name} (${m.file}) contributes no items`, async () => {
        const mod = (await import(/* @vite-ignore */ resolve(repoRoot, m.file))) as Record<string, ComponentType>;
        const C = mod[name];
        expect(typeof C === "function" || typeof C === "object", `${name} is not a component`).toBe(true);
        const r = itemsIn(<C />);
        expect(r, `counted inside ${name}: ${r.added.join(" | ")}`).toMatchObject({ n: 0 });
      });
    }
  }
});
