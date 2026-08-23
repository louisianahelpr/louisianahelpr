import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Every admin VIEW wears the same shell.
 *
 * Third instance of one defect class, after the Profile tabs and the dialogs —
 * a shared surface where each screen quietly picked its own spacing, so no
 * single screen looked wrong and the SET looked incoherent. Owner: "all admin
 * pages should also share the same shell."
 *
 * Measured across the 22 components /admin renders as `?view=` screens:
 *
 *   space-y-6 ......... 12   (the plurality — canonical)
 *   space-y-4 .......... 6   Broadcasts, Disputes, ExceptionQueue,
 *                            NotificationLogs, Reports, Support
 *   space-y-3 .......... 1   Users
 *   space-y-8 .......... 1   Settings
 *   space-y-6 max-w-2xl  1   Notifications
 *
 * The list is DERIVED from Admin.tsx's own `renderContent`, not hardcoded, so a
 * view added later is covered the day it is added rather than the day someone
 * remembers to update a list — which is precisely how the Profile tab test
 * managed to pass while seven tabs were off-shell.
 */
const SHELL = "space-y-6";
const ROOT = resolve(__dirname, "../../..");

/** The components /admin renders as views, read out of the router itself. */
function adminViews(): string[] {
  const src = readFileSync(resolve(ROOT, "src/pages/Admin.tsx"), "utf8");
  const i = src.indexOf("const renderContent");
  const block = src.slice(i, src.indexOf("\n  };", i));
  return [...new Set([...block.matchAll(/return <(Admin\w+)/g)].map((m) => m[1]))].sort();
}

/** The wrapper on a component's MAIN render — the last top-level `return (`,
 *  not a loading or empty-state early return above it. */
function mainWrapper(name: string): string | null {
  const f = resolve(ROOT, `src/components/admin/${name}.tsx`);
  if (!existsSync(f)) return null;
  const src = readFileSync(f, "utf8");
  const ms = [...src.matchAll(/return \(\s*\n\s*<div className="([^"]*)"/g)];
  return ms.length ? ms[ms.length - 1][1] : null;
}

describe("Admin views share one shell", () => {
  it("discovers the views from the router (guards the regex rotting)", () => {
    expect(adminViews().length).toBeGreaterThanOrEqual(15);
  });

  it("every view file the router names actually exists", () => {
    const missing = adminViews().filter((v) => mainWrapper(v) === null &&
      !existsSync(resolve(ROOT, `src/components/admin/${v}.tsx`)));
    expect(missing, "views named by the router with no file").toEqual([]);
  });

  it("every view's main wrapper is the shared shell", () => {
    const wrong: string[] = [];
    for (const v of adminViews()) {
      const w = mainWrapper(v);
      // A view whose top level isn't a plain <div className="…"> is not
      // asserted here — it has a structural reason (a Fragment, an early
      // centred loading state) and there is nothing to compare.
      if (w === null) continue;
      if (!w.startsWith("space-y-")) continue;
      if (w !== SHELL) wrong.push(`${v}: "${w}"`);
    }
    expect(wrong, `admin views off the shared shell ("${SHELL}")`).toEqual([]);
  });
});
