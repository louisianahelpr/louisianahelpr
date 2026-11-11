/**
 * Owner 11-11 (pop-up via the lead; audit 11-10 F363/F396/F322): Declutter showed three different counts for the
 * same work: the Buying tab "8" (declutterTodo's cart-and-offers count, plus questions on Selling), the bottom bar's
 * "7" (the Home To-do list) and the chips. Every Declutter BADGE now reads ONE source, the Home To-do count that
 * NeedsYouBridge publishes (needsYouStore), split into Buying and Selling. (The Buying "Needs you" chip waits on a
 * second owner answer: it counts the orders it shows, owner 10-28.)
 *
 * The class, from source: every place that hands a Declutter badge its number. The tab row's Buying and Selling
 * counts (DeclutterHomeView), and every nav that knows the "todoDeclutter" badge key (the phone dock, the desktop
 * rail), must read NeedsYouCounts; no tab count may read declutterTodo's buying / selling.
 *
 * @mutate src/components/declutter/DeclutterHomeView.tsx |     { value: "buying", label: "Buying", labelKey: "decl.tab.buying", count: needsYou.declutterBuying }, |     { value: "buying", label: "Buying", labelKey: "decl.tab.buying", count: todo?.buying },
 * @mutate src/components/declutter/DeclutterHomeView.tsx |     { value: "selling", label: "Selling", labelKey: "decl.tab.selling", quiet: forSale, count: needsYou.declutterSelling }, |     { value: "selling", label: "Selling", labelKey: "decl.tab.selling", quiet: forSale, count: todo ? todo.selling + questions.count : undefined },
 * @mutate src/lib/declutter/buyingTodo.ts |   return t.section === "declutter" && t.to.includes("tab=buying"); |   return t.section === "declutter";
 * @mutate src/components/mobileNav/dockBadgeCount.ts |             ? todo.declutter |             ? todo.total
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));

const todos = vi.hoisted(() => ({ list: [] as { id: string; section: string; to: string }[] }));
vi.mock("@/pages/home/homeDashboard/useNeedsYouTodos", () => ({ useNeedsYouTodos: () => ({ todos: todos.list, loading: false }) }));

import NeedsYouBridge from "@/components/NeedsYouBridge";
import { useNeedsYouCounts } from "@/lib/needsYouStore";

describe("owner 11-11: every Declutter badge reads the Home To-do count", () => {
  it("the Buying and Selling tab badges read needsYouStore's split, never declutterTodo's", () => {
    const home = read("src/components/declutter/DeclutterHomeView.tsx");
    expect(home).toMatch(/const needsYou = useNeedsYouCounts\(user\?\.id\);/);
    const buying = home.match(/\{ value: "buying", label: "Buying",[^}]*\}/)?.[0] ?? "";
    const selling = home.match(/\{ value: "selling", label: "Selling",[^}]*\}/)?.[0] ?? "";
    expect(buying).toMatch(/count: needsYou\.declutterBuying\b/);
    expect(selling).toMatch(/count: needsYou\.declutterSelling\b/);
  });

  it("no tab count anywhere reads declutterTodo's buying / selling", () => {
    const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "src/components", "src/pages"], { cwd: ROOT, encoding: "utf8" })
      .split("\n").filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThan(500);
    const offenders = files.filter((f) => /count:\s*todo\??\.(buying|selling)\b|todo\??\.selling\s*\+\s*questions/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("every nav with the todoDeclutter badge maps it to the To-do count's declutter", () => {
    const files = execFileSync("git", ["grep", "-l", "todoDeclutter", "--", "src"], { cwd: ROOT, encoding: "utf8" })
      .split("\n").filter((f) => /\.tsx?$/.test(f) && !f.startsWith("src/test/") && !/\.test\.tsx?$/.test(f));
    // dockItems (the key), dockBadgeCount (the phone dock) and DesktopSidebarNav (the rail), 2026-11-11.
    expect(files.length).toBeGreaterThan(2);
    let checked = 0;
    for (const f of files) {
      const src = read(f);
      if (!/badgeKey === "todoDeclutter"|key === "todoDeclutter"/.test(src)) continue;
      checked++;
      expect(src, f).toMatch(/(badgeKey|key) === "todoDeclutter"\)?\s*\n?\s*(\?|return)\s*todo\.declutter\b/);
    }
    expect(checked).toBe(2);
  });

  it("the bridge splits the Declutter to-dos by side: Buying rows open tab=buying, the rest (selling, a free pick) are Selling", () => {
    todos.list = [
      { id: "dc-1", section: "declutter", to: "/declutter?tab=buying" },
      { id: "dh-2", section: "declutter", to: "/declutter?tab=buying" },
      { id: "do-3", section: "declutter", to: "/declutter?tab=selling" },
      { id: "df-4", section: "declutter", to: "/declutter/item/i4" },
      { id: "p-5", section: "jobs", to: "/jobs" },
    ];
    let seen = { declutter: -1, declutterBuying: -1, declutterSelling: -1 };
    function Read() {
      seen = useNeedsYouCounts("u9");
      return null;
    }
    render(<><NeedsYouBridge user={{ id: "u9" } as never} /><Read /></>);
    expect({ declutter: seen.declutter, declutterBuying: seen.declutterBuying, declutterSelling: seen.declutterSelling })
      .toEqual({ declutter: 4, declutterBuying: 2, declutterSelling: 2 });
  });
});
