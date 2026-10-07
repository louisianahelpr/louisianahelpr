/**
 * Helpr Wrapped's undercount warning is drawn at FULL --accent-ink (Q949,
 * 2026-10-07). Photographed in its own state on prod (375, a forced partial
 * failure of the reviews read), the card under the line rendered
 * rgb(234,230,230) in light, not the surface the earlier token maths assumed,
 * and `--accent-ink / 0.9` measured 4.46:1 there, under the 4.5:1 floor for
 * 11px text; at full strength it is 5.33:1 light, 6.41:1 dark on the rendered
 * card. This is the line that admits the numbers may be wrong, so it carries
 * no alpha at all.
 *
 * @mutate src/pages/profile/HelprWrapped.tsx | style={{ color: "hsl(var(--accent-ink))" }} | style={{ color: "hsl(var(--accent-ink) / 0.9)" }}
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const SRC = blankComments(readFileSync(join(__dirname, "..", "pages", "profile", "HelprWrapped.tsx"), "utf8"));

describe("the Wrapped undercount warning is full-strength ink", () => {
  const at = SRC.indexOf("stats?.incomplete && (");
  const block = at >= 0 ? SRC.slice(at, at + 400) : "";

  it("finds the warning (inventory floor)", () => {
    expect(at).toBeGreaterThan(-1);
    expect(block).toMatch(/didn't load, so these numbers may be low/);
  });

  it("its colour is --accent-ink with no alpha", () => {
    const color = /color:\s*"([^"]+)"/.exec(block)?.[1];
    expect(color).toBe("hsl(var(--accent-ink))");
  });
});
