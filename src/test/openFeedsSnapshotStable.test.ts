// @mutate scripts/lib/openFeeds.mjs | if (JSON.stringify(prev) === JSON.stringify(cur)) return prevText; | if (false) return prevText;
// @mutate scripts/lib/openFeeds.mjs | const { measured_at: _b, ...cur } = snap; | const cur = snap;
// @mutate scripts/open-sync-trackers.mjs | writeFileSync(snapPath, snapshotText(existsSync(snapPath) ? readFileSync(snapPath, "utf8") : null, out)); | writeFileSync(snapPath, JSON.stringify(out, null, 2) + "\n");
/**
 * Bot churn (owner, 2026-10-14: "i feel like we are getting no wheres again").
 * open-auto-tick runs after every prod deploy and opens a refresh PR whenever
 * its regenerate step leaves a diff. open-sync-trackers stamped a fresh
 * measured_at into docs/audit/open-feeds.json on every run, so the diff was
 * never empty: the PR merged, the merge re-deployed prod, the deploy re-ran
 * the tick, and a PR merged every ~5 min (#3089-#3102) with nothing changed.
 * A re-measure whose only change is the timestamp must leave the file as is.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { snapshotText } from "../../scripts/lib/openFeeds.mjs";

const base = {
  note: "n",
  measured_at: "2026-10-14T18:20Z",
  issues: { readable: true, open: [{ number: 3007, title: "nightly-red: main: Vitest" }] },
  ledger: { readable: true, open: [] },
  mirrored: { "issue #3007": "Q1" },
};
const prevText = JSON.stringify(base, null, 2) + "\n";

describe("the feeds snapshot changes only when the feeds change", () => {
  it("keeps the previous text byte for byte when only measured_at moved", () => {
    expect(snapshotText(prevText, { ...base, measured_at: "2026-10-14T18:25Z" })).toBe(prevText);
  });

  it("writes the new snapshot (with its new time) when a feed changed", () => {
    const next = { ...base, measured_at: "2026-10-14T18:25Z", issues: { readable: true, open: [] } };
    const text = snapshotText(prevText, next);
    expect(text).not.toBe(prevText);
    expect(JSON.parse(text).measured_at).toBe("2026-10-14T18:25Z");
  });

  it("writes a first snapshot, and replaces an unreadable one", () => {
    expect(JSON.parse(snapshotText(null, base))).toEqual(base);
    expect(JSON.parse(snapshotText("{not json", base))).toEqual(base);
  });

  it("open-sync-trackers writes the snapshot through snapshotText at every write", () => {
    const src = readFileSync("scripts/open-sync-trackers.mjs", "utf8");
    const writes = [...src.matchAll(/writeFileSync\(([^,]+),/g)].map((m) => m[1].trim());
    const snapWrites = writes.filter((w) => !w.startsWith("join(ROOT"));
    expect(snapWrites.length).toBe(2);
    expect(src.match(/writeFileSync\([^,]+, snapshotText\(/g)?.length).toBe(2);
  });
});
