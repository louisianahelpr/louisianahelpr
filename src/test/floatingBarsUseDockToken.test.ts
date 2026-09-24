import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { readSource, walkSource } from "./helpers/walkSource";

/**
 * THE CLASS (Q214, widened Q314): a fixed floating bar (or a scrolling page's
 * bottom clearance) whose offset reads the raw `env(safe-area-inset-bottom)`
 * with a hand-typed dock height, instead of the shared `safe-nav` token
 * (tailwind.config.ts: `--safe-area-bottom` + `--bottom-nav-h` + 1rem).
 * BulkDismissBar sat at `calc(env(safe-area-inset-bottom, 0px) + 80px)`,
 * ignoring `--bottom-nav-h`. Q314: `FormStep.tsx` hand-typed the identical
 * `env(...) + 96px + 1rem` formula in an inline `paddingBottom`, and
 * `LegalTab.tsx` put raw `env(...)` in its `ProfileTabBody bottomClearance`
 * prop — the same transform-ancestor bug (index.css: `env()` resolves to 0
 * inside any `<PageTransition>`'s transform), just on padding-bottom instead
 * of a fixed bar's `bottom`.
 *
 * Inventory from source: every `bottom`/`padding-bottom` offset in a .tsx
 * file — inline style (`bottom:`/`paddingBottom:`), Tailwind class
 * (`bottom-[...]`/`pb-[...]`), or the `bottomClearance` prop
 * (`ProfileTabBody`'s one named padding-bottom escape hatch). None may read
 * env() directly.
 */
const files = walkSource(["src"], [".tsx"]).filter((f) => !f.includes("/test/"));
const offsets: { file: string; value: string }[] = [];
for (const file of files) {
  const src = readSource(file);
  if (src === null) continue;
  const code = blankComments(src);
  for (const m of code.matchAll(/\bbottom:\s*(["'`])([^"'`]*)\1/g)) offsets.push({ file, value: m[2] });
  for (const m of code.matchAll(/\bbottom-\[([^\]]*)\]/g)) offsets.push({ file, value: m[1] });
  for (const m of code.matchAll(/\bpaddingBottom:\s*(["'`])([^"'`]*)\1/g)) offsets.push({ file, value: m[2] });
  for (const m of code.matchAll(/\bpb-\[([^\]]*)\]/g)) offsets.push({ file, value: m[1] });
  for (const m of code.matchAll(/\bbottomClearance=(["'`])([^"'`]*)\1/g)) offsets.push({ file, value: m[2] });
}

describe("floating bottom bars clear the dock with the shared token (Q214/Q314)", () => {
  it("scans the real component tree", () => {
    expect(files.length).toBeGreaterThan(300);
    expect(offsets.length).toBeGreaterThan(5);
  });

  it("no bottom/padding-bottom offset reads env(safe-area-inset-bottom) directly", () => {
    // @mutate src/pages/posts/BulkDismissBar.tsx | className="fixed inset-x-0 bottom-safe-nav z-40 px-4" | className="fixed inset-x-0 z-40 px-4" style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 80px)" }}
    const bad = offsets
      .filter((o) => o.value.includes("env(safe-area-inset-bottom"))
      .map((o) => `${o.file}: ${o.value}`);
    expect(bad).toEqual([]);
  });

  it("BulkDismissBar sits on the safe-nav token", () => {
    const code = blankComments(readSource("src/pages/posts/BulkDismissBar.tsx") ?? "");
    expect(code).toMatch(/className="[^"]*\bfixed\b[^"]*\bbottom-safe-nav\b/);
  });

  it("FormStep's submit clearance sits on the pb-safe-nav token (Q314)", () => {
    const code = blankComments(readSource("src/pages/post-job/FormStep.tsx") ?? "");
    expect(code).toMatch(/className="[^"]*\bpb-safe-nav\b/);
  });

  it("LegalTab's bottomClearance reads the shared --safe-area-bottom var, not raw env() (Q314)", () => {
    // Not the full pb-safe-nav value: Profile.tsx's own tab scroll container
    // already reserves the full dock clearance (`pb-[calc(var(--safe-area-bottom,0px)_+_96px_+_1rem)]`
    // at Profile.tsx:785); this prop is EXTRA room on top of that baseline for
    // the tab's own floating pill, so it keeps its bespoke `+ 6rem` and only
    // swaps the raw env() for the same `--safe-area-bottom` var the shared
    // token itself reads.
    const code = blankComments(readSource("src/components/profile/LegalTab.tsx") ?? "");
    expect(code).toMatch(/bottomClearance="calc\(var\(--safe-area-bottom, 0px\) \+ 6rem\)"/);
  });
});
