/**
 * Polish audit 11-27 #73 (~/.lh-shots/polish-audit-1127/FINDINGS.md, home-account/tab-referral--in-390--1.png): the
 * three Referrals tiles each wore a different small icon (people, $, gift) and "Total earned" wrapped to two lines
 * while its neighbours did not. The tiles are now plain labels, "Signed up / Earned / To cash out", over the number
 * (money stays rust, spec v2). Inventory: every tile the Referrals screen draws.
 *
 * @mutate src/components/ReferralSection.tsx |           { label: "Earned", value: | { icon: Copy, label: "Total earned", value:
 * @mutate src/components/ReferralSection.tsx |           { label: "Signed up", value: String(referralCount), money: false }, |           { icon: Copy, label: "Signed up", value: String(referralCount), money: false },
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const src = blankComments(readFileSync(resolve(__dirname, "../components/ReferralSection.tsx"), "utf8"));
/** The tile list: the array mapped into the three-column grid. */
const grid = src.slice(src.indexOf('<div className="grid grid-cols-3 gap-2">'), src.indexOf("].map(", src.indexOf('<div className="grid grid-cols-3 gap-2">')));
const tiles = grid.split("\n").filter((l) => /label: "/.test(l)).map((l) => ({ body: l, label: /label: "([^"]+)"/.exec(l)![1] }));

describe("#73: the Referrals tiles are plain", () => {
  it("finds the three tiles (inventory floor)", () => {
    expect(tiles.map((t) => t.label)).toEqual(["Signed up", "Earned", "To cash out"]);
    expect(tiles.length).toBeGreaterThan(2);
  });
  it.each(tiles.map((t) => [t.label, t.body] as const))("%s has no icon", (_l, body) => {
    expect(body).not.toMatch(/\bicon\s*:/);
  });
  it("no label is long enough to wrap beside the others", () => {
    for (const t of tiles) expect(t.label.length).toBeLessThanOrEqual(11);
  });
});
