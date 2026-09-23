import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { readSource, walkSource } from "./helpers/walkSource";

/**
 * THE CLASS (Q214): a fixed floating bar whose `bottom` offset reads the raw
 * `env(safe-area-inset-bottom)` with a hand-typed dock height, instead of the
 * shared `safe-nav` token (tailwind.config.ts: `--safe-area-bottom` +
 * `--bottom-nav-h` + 1rem). BulkDismissBar sat at
 * `calc(env(safe-area-inset-bottom, 0px) + 80px)`, ignoring `--bottom-nav-h`.
 *
 * Inventory from source: every `bottom` offset in a .tsx file, inline style
 * (`bottom: "..."`) or Tailwind class (`bottom-[...]`). None may read env().
 */
const files = walkSource(["src"], [".tsx"]).filter((f) => !f.includes("/test/"));
const offsets: { file: string; value: string }[] = [];
for (const file of files) {
  const src = readSource(file);
  if (src === null) continue;
  const code = blankComments(src);
  for (const m of code.matchAll(/\bbottom:\s*(["'`])([^"'`]*)\1/g)) offsets.push({ file, value: m[2] });
  for (const m of code.matchAll(/\bbottom-\[([^\]]*)\]/g)) offsets.push({ file, value: m[1] });
}

describe("floating bottom bars clear the dock with the shared token (Q214)", () => {
  it("scans the real component tree", () => {
    expect(files.length).toBeGreaterThan(300);
    expect(offsets.length).toBeGreaterThan(5);
  });

  it("no bottom offset reads env(safe-area-inset-bottom) directly", () => {
    // @mutate src/pages/activity/BulkDismissBar.tsx | className="fixed inset-x-0 bottom-safe-nav z-40 px-4" | className="fixed inset-x-0 z-40 px-4" style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 80px)" }}
    const bad = offsets
      .filter((o) => o.value.includes("env(safe-area-inset-bottom"))
      .map((o) => `${o.file}: ${o.value}`);
    expect(bad).toEqual([]);
  });

  it("BulkDismissBar sits on the safe-nav token", () => {
    const code = blankComments(readSource("src/pages/activity/BulkDismissBar.tsx") ?? "");
    expect(code).toMatch(/className="[^"]*\bfixed\b[^"]*\bbottom-safe-nav\b/);
  });
});
