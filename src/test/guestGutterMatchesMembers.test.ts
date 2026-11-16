/**
 * Simulator check 11-16 (after M13): the guest Jobs feed (/browse) drew its header and its "Jobs | Declutter" switch
 * at x 20 while guest Declutter and every member screen (Dashboard, member Declutter) sat at x 16, so the switch
 * jumped 4px between the two guest screens. The guest feed now takes the members' PageScaffold gutter (tightGutter),
 * and its loading skeleton's header row the same 16px.
 *
 * @mutate src/pages/home/DashboardGuest.tsx |         tightGutter\n |
 * @mutate src/components/GuestBrowseSkeleton.tsx | flex h-14 items-center justify-between gap-2 px-4 lg:px-8"> | flex h-14 items-center justify-between gap-2 px-5 lg:px-8">
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const src = (p: string) => blankComments(readFileSync(join(process.cwd(), p), "utf8"));

/** Each <PageScaffold ...> opening tag in a file: from the tag to its closing ">" line (a line holding only ">" or
 * "/>"), so props whose values hold JSX are read whole. */
function scaffolds(file: string): string[] {
  const lines = src(file).split("\n");
  const out: string[] = [];
  lines.forEach((l, i) => {
    if (!l.includes("<PageScaffold")) return;
    let j = i;
    while (j < lines.length && !/^\s*\/?>\s*$/.test(lines[j]) && !(j === i && /<PageScaffold[^\n]*>\s*$/.test(l))) j++;
    out.push(lines.slice(i, j + 1).join("\n"));
  });
  return out;
}

describe("the guest feed's gutter is the members' (sim check 11-16)", () => {
  it("member Dashboard uses the tight gutter (the reference), and so does every guest feed PageScaffold", () => {
    const member = scaffolds("src/pages/home/Dashboard.tsx");
    const guest = scaffolds("src/pages/home/DashboardGuest.tsx");
    // Inventory floor: the scaffolds are found at all.
    expect(member.length).toBeGreaterThan(0);
    expect(guest.length).toBeGreaterThan(0);
    for (const m of member) expect(m).toMatch(/\btightGutter\b/);
    for (const g of guest) expect(g).toMatch(/\btightGutter\b/);
  });

  it("the guest skeleton's header row pads 16px on a phone, as the real header does", () => {
    const sk = src("src/components/GuestBrowseSkeleton.tsx");
    const row = sk.split("\n").find((l) => l.includes("flex h-14 items-center justify-between"));
    expect(row).toBeDefined();
    expect(row).toMatch(/\bpx-4\b/);
    expect(row).not.toMatch(/\bpx-5\b/);
  });
});
