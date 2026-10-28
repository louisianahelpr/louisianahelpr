/**
 * NO SECTION "+" IN ANY SECTION HEADER (owner, 2026-10-28, desktop /jobs, about the filled "+ Post a job"
 * in the section top bar: "well actually do we need the post a job since the create is to post etc?").
 * Creating lives in ONE place: the left rail's "+ Create" on the desktop website, the bottom bar's
 * center "+" on a phone. Before this the bar's "+" had been a ghost icon the size of the bell (owner
 * 2026-10-19) and then a filled, labelled button on desktop (owner 2026-10-28, earlier the same day).
 *
 * The class, from source: AppTopBar draws no create control at all (no `section-add`, no `add` prop),
 * and no section header in the app (every `<AppTopBar` / `<SectionScreen` call site under src/, listed
 * from git) hands it one. The bar's icon controls that remain (the gear, the bell) keep one size.
 *
 * @mutate src/components/sections/AppTopBar.tsx |   if (isWebDesktop && !title && !settings) return null; |   if (isWebDesktop && !title && !settings) return null;\n  const addButton = <Button type="button" data-testid="section-add" aria-label="Post a job" />;
 * @mutate src/components/sections/SectionScreen.tsx |             <AppTopBar title={title} explore section={section} /> |             <AppTopBar title={title} add={{ label: "Add", path: "/" }} explore section={section} />
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";

const ROOT = resolve(__dirname, "../..");
const read = (f: string) => blankComments(readFileSync(resolve(ROOT, f), "utf8"));
const bar = read("src/components/sections/AppTopBar.tsx");

describe("no section + in any section header (owner 2026-10-28)", () => {
  it("AppTopBar draws no create control and takes no `add`", () => {
    expect(bar).not.toContain('data-testid="section-add"');
    expect(bar).not.toMatch(/\badd\??\s*:/);
    expect(bar).not.toMatch(/\bPlus\b/);
  });

  it("no section header call site passes one", () => {
    const sites = trackedFiles("src")
      .filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f) && !f.startsWith("src/test/"))
      .flatMap((f) => {
        const src = read(f);
        return [...src.matchAll(/<(AppTopBar|SectionScreen)\b[^>]*>/gs)].map((m) => ({ f, tag: m[0] }));
      });
    // Inventory floor: the four sections, their loading frames, Home, Messages and You all use these.
    expect(sites.length).toBeGreaterThan(8);
    const offenders = sites.filter((s) => /\sadd=\{/.test(s.tag)).map((s) => `${s.f}: ${s.tag.slice(0, 90)}`);
    expect(offenders).toEqual([]);
  });

  it("the bar's remaining icon controls keep one size (the bell's class starts with the icon class)", () => {
    const icon = bar.match(/const TOP_BAR_ICON_CLASS = "([^"]+)";/)?.[1] ?? "";
    expect(icon).toMatch(/h-11 w-11/);
    const bell = bar.match(/<NotificationPanel triggerClassName="([^"]+)"/)?.[1] ?? "";
    expect(bell.startsWith(icon), `bell "${bell}" vs icon "${icon}"`).toBe(true);
  });

  it("no filled primary surface anywhere in the bar", () => {
    expect(bar).not.toMatch(/btn-grad-primary/);
  });
});
