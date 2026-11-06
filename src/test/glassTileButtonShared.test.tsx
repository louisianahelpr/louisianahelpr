/**
 * Q2709 "nothing hand-made" (Home packet, Builder 2, 2026-11-06; lead: on Home convert ONLY what stays look-identical).
 * Home's section tiles and money tiles were hand-made <button>s on the liquid-glass surface; they are the shared
 * GlassTileButton now. Look-identical by construction: the rendered class SET of each tile is exactly the hand-made
 * one (CSS does not read class order), asserted here on the real component with each caller's className.
 *
 * @mutate src/components/ui/GlassTileButton.tsx | const GLASS_TILE = "btn-press liquid-glass text-left flex flex-col min-w-0"; | const GLASS_TILE = "btn-press liquid-glass text-left flex flex-col min-w-0 rounded-xl";
 * @mutate src/components/ui/GlassTileButton.tsx |     <button ref={ref} type="button" {...props} | <button ref={ref} {...props}
 * @mutate src/pages/home/HomeDashboard.tsx |                     className="p-card lg:p-4 gap-1 lg:gap-0.5" |                     className="p-card lg:p-4 gap-1"
 * @mutate src/pages/home/homeDashboard/HomeMoneyTiles.tsx |       className={`p-card lg:p-4 gap-0.5 ${span}`} |       className={`p-card gap-0.5 ${span}`}
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { GlassTileButton } from "@/components/ui/GlassTileButton";

const set = (cls: string) => [...new Set(cls.split(/\s+/).filter(Boolean))].sort();
const classOf = (className: string) => {
  const { container } = render(<GlassTileButton className={className}>x</GlassTileButton>);
  const b = container.querySelector("button")!;
  return { cls: b.getAttribute("class") ?? "", type: b.getAttribute("type") };
};
/** The caller's className literal in its source, so the test reads what ships. */
const literal = (file: string, re: RegExp) => readFileSync(file, "utf8").match(re)?.[1] ?? "<missing>";

describe("Home's glass tiles are the shared GlassTileButton, class for class the hand-made look", () => {
  it("section tile: the same class set as the hand-made button", () => {
    const own = literal("src/pages/home/HomeDashboard.tsx", /data-section-tile=\{s\.key\}[\s\S]*?className="([^"]+)"/);
    const { cls, type } = classOf(own);
    expect(set(cls)).toEqual(set("btn-press liquid-glass text-left p-card lg:p-4 flex flex-col gap-1 lg:gap-0.5 min-w-0"));
    expect(type).toBe("button");
  });

  it("money tile: the same class set as the hand-made button (span passed through)", () => {
    const own = literal("src/pages/home/homeDashboard/HomeMoneyTiles.tsx", /data-money-tile=\{kind\}[\s\S]*?className=\{`([^`]+)`\}/).replace("${span}", "col-span-2");
    const { cls } = classOf(own);
    expect(set(cls)).toEqual(set("btn-press liquid-glass text-left p-card lg:p-4 flex flex-col gap-0.5 min-w-0 col-span-2"));
  });

  it("neither file keeps a hand-made glass tile", () => {
    for (const f of ["src/pages/home/HomeDashboard.tsx", "src/pages/home/homeDashboard/HomeMoneyTiles.tsx"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/<button[^>]*>?[^<]*liquid-glass/);
      expect(readFileSync(f, "utf8")).toContain("<GlassTileButton");
    }
  });
});
