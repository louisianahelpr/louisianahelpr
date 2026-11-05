/**
 * CLASS GUARD (Q2709, 2026-11-05 night; owner 10-31 "Nothing hand-made"): Deliver for pay's "Online for deliveries"
 * toggle is the shared Switch (src/components/ui/switch.tsx: the app's 31x51 track, its 44px hit area, the light
 * haptic), never a hand-made <button role="switch">. The hand-made one was a 32x56 track whose tap target was its
 * 32px artwork (under the 44px minimum). It keeps its name ("Online for deliveries", from the sr-only line) and its
 * busy lock; the hand-made ratchet lost the file's entry in the same commit.
 *
 * @mutate src/components/declutter/GoOnlineCard.tsx | <Switch aria-labelledby={`${id}-label`} checked={online} | <Switch checked={online}
 * @mutate src/components/declutter/GoOnlineCard.tsx | checked={online} disabled={flip.isPending \|\| status.isLoading} | checked={online} disabled={status.isLoading}
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const src = blankComments(readFileSync(resolve(__dirname, "..", "..", "src/components/declutter/GoOnlineCard.tsx"), "utf8"));

describe("Go online uses the shared Switch (Q2709)", () => {
  it("the online toggle is the shared Switch, named and locked while it saves", () => {
    const tags = [...src.matchAll(/<Switch\b[\s\S]*?\/>/g)].map((m) => m[0]);
    expect(tags.length).toBeGreaterThan(0);
    const sw = tags.find((t) => t.includes("checked={online}"));
    expect(sw, "the online toggle is not the shared Switch").toBeDefined();
    expect(sw!).toContain("aria-labelledby={`${id}-label`}");
    expect(src).toContain('<span id={`${id}-label`} className="sr-only">Online for deliveries</span>');
    expect(sw!).toContain("disabled={flip.isPending || status.isLoading}");
    expect(src, "a hand-made switch is back").not.toMatch(/<button\b[^>]*role="switch"/);
  });
});
