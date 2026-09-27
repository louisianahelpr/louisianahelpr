// @mutate scripts/lib/openFeeds.mjs | const TAG = /feed: (issue | const TAG = /feedX: (issue
// @mutate scripts/lib/openFeeds.mjs | .map((m) => m[1]); | .map((m) => `${m[1]}x`);
/**
 * docs/OPEN.md is the ONE open-work list (owner, 2026-09-27: "can this just be
 * merged into open so we aren't tracking several different things"). Every open
 * source item in the other trackers (the ops alert ledger, the open nightly-red
 * issues, the audit bus) must be mirrored by exactly one not-done OPEN.md item
 * carrying its `feed:` tag. scripts/open-sync-trackers.mjs writes the tags and
 * the measured snapshot docs/audit/open-feeds.json (ledger + issues, refreshed
 * nightly by scoreboard.yml); the bus is folded here from the committed log, so
 * a finding filed without a queue line fails CI at once.
 *
 * Red when: an open source has no OPEN.md line, or two not-done items carry
 * the same source. Fix: `node scripts/open-sync-trackers.mjs` (or `--offline`
 * for bus-only changes).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FINDINGS, SNAPSHOT, busSources, mirrorProblems } from "../../scripts/lib/openFeeds.mjs";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

type Snap = {
  issues: { readable: boolean; open: { number: number }[] };
  ledger: { readable: boolean; open: { fingerprint: string }[] };
};

describe("every open tracker item has an OPEN.md line", () => {
  const snap = JSON.parse(read(SNAPSHOT)) as Snap;
  const bus = (busSources(read(FINDINGS)) as { keys: string[] }[]).flatMap((g) => g.keys);
  const keys: string[] = [
    ...snap.issues.open.map((i) => `issue #${i.number}`),
    ...snap.ledger.open.map((r) => `ledger ${r.fingerprint.slice(0, 12)}`),
    ...bus,
  ];
  const md = read("docs/OPEN.md");

  it("the snapshot was measured with every feed readable", () => {
    expect(snap.issues.readable && snap.ledger.readable).toBe(true);
  });

  it("measures a real set of sources (floor)", () => {
    expect(keys.length).toBeGreaterThan(5);
  });

  it("no open source is missing from OPEN.md, and none is on two items", () => {
    const { missing, doubled } = mirrorProblems(keys, md) as { missing: string[]; doubled: string[] };
    expect(missing, "run: node scripts/open-sync-trackers.mjs").toEqual([]);
    expect(doubled).toEqual([]);
  });
});
