import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { releaseSharedLayout } from "@/components/ui/SharedLayoutPill";

/**
 * THE CLASS (PD-009): a framer shared-layout element (`layoutId`) that
 * outlives its page.
 *
 * framer keeps every `layoutId` in a NodeStack on the document-global root
 * projection node, and `NodeStack.remove()` never clears `lead` when the last
 * member unmounts. Measured 2026-09-25 (CDP DOM.getDetachedDomNodes after
 * forced GC): /legal's `legalTabPill` kept the two previous /legal pages alive,
 * 478 detached DOM nodes, for the life of the tab. `SharedLayoutPill` drops the
 * stack when nothing replaced the pill. A raw `layoutId` anywhere else brings
 * the retention back, so the ONLY place `layoutId` may be written as a JSX prop
 * is that primitive. The runtime proof is e2e/memory/route-retention.spec.ts.
 *
 * Inventory is every .tsx under src/ (the app's own source, not a list typed
 * here); comments are blanked so prose about `layoutId` is not a hit.
 *
 * @mutate src/pages/info/Legal.tsx | <SharedLayoutPill | <motion.span
 */

const REPO = resolve(__dirname, "../..");
const PRIMITIVE = "src/components/ui/SharedLayoutPill.tsx";

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...tsxFiles(p));
    else if (e.name.endsWith(".tsx") && !/\.test\.tsx$/.test(e.name)) out.push(relative(REPO, p));
  }
  return out;
}

const files = tsxFiles(join(REPO, "src"));
const code = new Map(files.map((f) => [f, blankComments(readFileSync(join(REPO, f), "utf8"))]));

describe("every framer layoutId goes through SharedLayoutPill (PD-009)", () => {
  it("scans the real source tree", () => {
    expect(files.length).toBeGreaterThan(400);
    expect(files).toContain(PRIMITIVE);
  });

  it("no raw `layoutId=` JSX prop outside the primitive", () => {
    const hits: string[] = [];
    for (const [f, src] of code) {
      if (f === PRIMITIVE) continue;
      for (const m of src.matchAll(/\blayoutId\s*=/g)) {
        // The element the prop belongs to: the last opening tag before it. Found
        // backwards rather than with one regex so an `onClick={() => …}` earlier
        // in the same tag (a `>` inside it) cannot hide the prop.
        const tags = [...src.slice(0, m.index).matchAll(/<([A-Za-z][\w.]*)/g)];
        const tag = tags.length ? tags[tags.length - 1][1] : "?";
        if (tag === "SharedLayoutPill") continue;
        const line = src.slice(0, m.index).split("\n").length;
        hits.push(`${f}:${line} <${tag} layoutId=…> — use <SharedLayoutPill layoutId=…> (src/components/ui/SharedLayoutPill.tsx)`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("the pills that exist use the primitive (inventory floor)", () => {
    let uses = 0;
    for (const [f, src] of code) if (f !== PRIMITIVE) uses += (src.match(/<SharedLayoutPill\b/g) ?? []).length;
    // Legal, LegalTab, SubscriptionTab and MobileNav's two on 2026-09-25.
    expect(uses).toBeGreaterThan(4);
  });
});

describe("releaseSharedLayout", () => {
  const nodeWith = (stacks: Map<string, { members: unknown[] }>) => ({ root: { sharedNodes: stacks } });

  it("drops the stack once no pill is left in it (the page went away)", () => {
    const stacks = new Map([["pill", { members: [] as unknown[] }]]);
    expect(releaseSharedLayout(nodeWith(stacks), "pill")).toBe(true);
    expect(stacks.has("pill")).toBe(false);
  });

  it("leaves it alone while a replacement pill is mounted (a tab switch keeps its slide)", () => {
    const stacks = new Map([["pill", { members: [{}] as unknown[] }]]);
    expect(releaseSharedLayout(nodeWith(stacks), "pill")).toBe(false);
    expect(stacks.has("pill")).toBe(true);
  });

  it("is a no-op without a projection node or stack", () => {
    expect(releaseSharedLayout(undefined, "pill")).toBe(false);
    expect(releaseSharedLayout(nodeWith(new Map()), "pill")).toBe(false);
  });
});
