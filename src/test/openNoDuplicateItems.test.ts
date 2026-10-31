/*
 * GUARD (2026-10-03): one item is never counted under two numbers.
 *
 * scripts/open-renumber.mjs met the SAME item twice under one number (ticked
 * into an archive by the landing branch, still open in docs/OPEN.md on main),
 * took the pair for a number collision and gave the ticked copy a fresh number.
 * f38b17024 made Q456 -> Q919, Q877 -> Q920, Q878 -> Q921, Q897 -> Q922,
 * Q899 -> Q923 and Q900 -> Q924, and Q732 was an exact copy of Q708: Q456 was
 * counted open AND done, six done items were counted twice, and the queue said
 * 925 items where there were 918. Every count keyed on the number
 * (queue-count, the Everything-open block) was wrong and no check could see it.
 *
 * Class check: across docs/OPEN.md and every done archive, no two numbers share
 * an origin (scripts/lib/openQueue.mjs itemOriginKey: a feed item's
 * "Mirrored|Filed <date> from <source>", else its first 100 characters). An
 * alert that fires again on a later date is mirrored as a NEW item with a
 * different date, so real repeats (staleness-watch red twice: Q917, Q787) pass.
 * Red first: 7 groups on origin/main at ca5acf08d.
 *
 * AND (owner 2026-10-14: "make sure this a rule that the same item merges if
 * it already has an item open. remove duplicate items"): while an OPEN item
 * exists for a problem, a new sighting of it is ATTACHED to that item
 * (applyFeeds: "Seen again <date>"), never filed under a new number; only
 * once the first is ticked may it come back under a new one. Two OPEN items
 * ([ ] or [~]) with the same normalised title (itemTitleKey: no number,
 * tier, dates, digits, Vite hashes, case or punctuation) fail, exact zero.
 * Red first: 3 pairs on origin/main at 99cf3ca4c (Q1596/Q1811 "permission
 * denied for table profiles", Q1610/Q1700 "functionshttperror ...",
 * Q1636/Q1812 "session lost on a signed-in screen"), merged 2026-10-14.
 */
// @mutate scripts/lib/openQueue.mjs | .filter(([, ids]) => ids.size > 1) | .filter(([, ids]) => ids.size > 99)
// @mutate scripts/lib/openQueue.mjs |   if (o) return `origin ${o[1]} ${o[2].toLowerCase()}`; |   if (o) return `origin ${line}`;
// @mutate scripts/lib/openQueue.mjs | .filter(([, ids]) => ids.length > 1).map(([key, ids]) => ({ key, ids })); | .filter(([, ids]) => ids.length > 99).map(([key, ids]) => ({ key, ids }));
// @mutate scripts/lib/openQueue.mjs |     .replace(VITE_HASH, "") |     .replace(VITE_HASH, "$&")
// @mutate scripts/lib/openQueue.mjs |     if (!m \|\| m[1] === "x") continue;\n    const key = itemTitleKey(line); |     if (!m) continue;\n    const key = itemTitleKey(line);
// @mutate scripts/lib/openFeeds.mjs |     if (same.length) { |     if (false) {
// @mutate scripts/lib/openFeeds.mjs |     if (filed) { |     if (false) {
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error — plain .mjs module, no declaration file
import { queueText, duplicateItems, itemOriginKey, itemTitleKey, openTitleDuplicates } from "../../scripts/lib/openQueue.mjs";
import { applyFeeds, groupSources, queueItems } from "../../scripts/lib/openFeeds.mjs";

const ROOT = join(__dirname, "..", "..");
const fed = (n: number, s: string, date: string, extra = "") =>
  `- [${s}] **Q${n} nightly-red: x is red.**${extra} Mirrored ${date} from nightly-red issue #7 and alert-ledger row 0123456789ab by \`scripts/open-sync-trackers.mjs\`: find the root cause.`;
const LONG = "(lh-money-escrow review, 2026-09-25, code read only): a job left at payment_status 'cancelling' is picked up by nothing";

describe("no item is counted under two numbers", () => {
  it("the real queue (OPEN.md + archives) has no item under two numbers", () => {
    const md = queueText(ROOT);
    expect(md.split("\n").filter((l: string) => /^- \[[ x~]\] \*\*Q\d+/.test(l)).length).toBeGreaterThan(500);
    expect(duplicateItems(md)).toEqual([]);
  });

  it("a ticked copy renumbered away from its open original is caught", () => {
    const md = [fed(5, " ", "2026-09-30"), fed(9, "x", "2026-09-30", " DONE 2026-10-02: closed.")].join("\n");
    expect(duplicateItems(md)).toEqual([
      { key: "origin 2026-09-30 nightly-red issue #7 and alert-ledger row 0123456789ab", items: [{ id: "Q5", state: " " }, { id: "Q9", state: "x" }] },
    ]);
  });

  it("an unfed item copied under a new number is caught by its text", () => {
    expect(duplicateItems([`- [ ] **Q456** ${LONG}`, `- [x] **Q919** ${LONG} DONE.`].join("\n")).map((g: { items: { id: string }[] }) => g.items.map((i) => i.id))).toEqual([["Q456", "Q919"]]);
  });

  it("the same alert firing again AFTER its item was ticked may take a new number (history is out of scope)", () => {
    expect(duplicateItems([fed(5, "x", "2026-09-30"), fed(9, " ", "2026-10-02")].join("\n"))).toEqual([]);
    expect(openTitleDuplicates([fed(5, "x", "2026-09-30"), fed(9, " ", "2026-10-02")].join("\n"))).toEqual([]);
  });

  it("the same problem seen again while its item is OPEN merges into that item: no new number", () => {
    const md = [
      "# OPEN", "", "## FEEDS — x", "",
      "- [ ] **Q1596 MEDIUM error: permission denied for table profiles.** Mirrored 2026-10-09 from alert-ledger row dd274a9b4b57 (sentry: sentry:cu(assets/app-shared-DUoNbpYC)) by `scripts/open-sync-trackers.mjs`. feed: ledger dd274a9b4b57.",
      "", "## CARRIED", "",
    ].join("\n");
    const again = groupSources({
      ledger: [{ fingerprint: "caab19e71ae99b285e20eb42a5be1291", source_kind: "sentry", source: "sentry:Ku(assets/app-shared-CkIDj-oG)", status: "open", title: "error: permission denied for table profiles", sample_ref: {} }],
      issues: [],
    });
    const res = applyFeeds(md, again, { status: () => "open", nextFree: 1811, today: "2026-10-14" });
    expect(res.created).toEqual([]);
    expect(res.attached).toEqual([{ id: "Q1596", keys: ["ledger caab19e71ae9"], seenAgain: true }]);
    const items = queueItems(res.md);
    expect(items.map((i) => i.id)).toEqual(["Q1596"]);
    expect(items[0].text).toContain("**Seen again 2026-10-14**");
    expect(items[0].text).toContain("feed: ledger caab19e71ae9");
    // a problem with a different title is still filed on its own
    const other = groupSources({ ledger: [{ fingerprint: "e067480712413dc7e3b99490c9b7c4f6", source_kind: "sentry", source: "sentry:assets/app-shared", status: "open", title: "error: permission denied for table jobs", sample_ref: {} }], issues: [] });
    expect(applyFeeds(md, other, { status: () => "open", nextFree: 1811, today: "2026-10-14" }).created.map((c) => c.id)).toEqual(["Q1811"]);
  });

  it("two sources with one title in ONE sync file one number, not two (Q2511/Q2512, bot PR #3820)", () => {
    const md = ["# OPEN", "", "## FEEDS — x", "", "- [ ] **Q1 LOW something else.** keep me.", "", "## CARRIED", ""].join("\n");
    const row = (fingerprint: string, source: string) => ({ fingerprint, source_kind: "sentry", source, status: "open", title: "error: jwt expired", sample_ref: {} });
    const groups = groupSources({ ledger: [row("e6fb014ab0990d29fdeee5b923e5f1e4", "sentry:assets/signed-in-shared"), row("acebac9d71e7669e5e61232c13345a12", "sentry:assets/app-shared")], issues: [] });
    const opts = { status: () => "open" as const, nextFree: 2511, today: "2026-10-31" };
    const res = applyFeeds(md, groups, opts);
    expect(res.created.map((c) => c.id)).toEqual(["Q2511"]);
    expect(res.attached).toEqual([{ id: "Q2511", keys: ["ledger acebac9d71e7"], seenAgain: true }]);
    expect(openTitleDuplicates(res.md)).toEqual([]);
    const jwt = queueItems(res.md).filter((i) => i.text.includes("jwt expired"));
    expect(jwt.map((i) => i.id)).toEqual(["Q2511"]);
    // both sources stay mirrored, each with its own done-when, and a re-sync changes nothing
    expect(jwt[0].text).toContain("feed: ledger e6fb014ab099");
    expect(jwt[0].text).toContain("feed: ledger acebac9d71e7");
    expect(jwt[0].text).toContain("fingerprint = 'e6fb014ab0990d29fdeee5b923e5f1e4'");
    expect(jwt[0].text).toContain("fingerprint = 'acebac9d71e7669e5e61232c13345a12'");
    expect(applyFeeds(res.md, groups, { ...opts, nextFree: 2600 }).md).toBe(res.md);
    // a different title in the same sync still files its own number
    const other = groupSources({ ledger: [row("e6fb014ab0990d29fdeee5b923e5f1e4", "a"), { ...row("0123456789ab0123456789ab01234567", "b"), title: "error: permission denied for table jobs" }], issues: [] });
    expect(applyFeeds(md, other, opts).created.map((c) => c.id)).toEqual(["Q2511", "Q2512"]);
  });

  it("two OPEN items whose titles differ only by number, tier, date, digits or a Vite hash are one problem", () => {
    const a = "- [ ] **Q1 MEDIUM error: session lost on /assets/ProtectedRoute-CAbqOrT0.js at 2026-10-09 (3 times).** x";
    const b = "- [~] **Q2 LOW Error: Session lost on /assets/ProtectedRoute-BOkAU22A.js at 2026-10-13 (12 times).** y";
    expect(itemTitleKey(a)).toBe(itemTitleKey(b));
    expect(openTitleDuplicates([a, b].join("\n"))).toEqual([{ key: itemTitleKey(a), ids: ["Q1", "Q2"] }]);
    // a ticked copy is history, not a duplicate; a real word is not a hash
    expect(openTitleDuplicates([a, b.replace("- [~]", "- [x]")].join("\n"))).toEqual([]);
    expect(itemTitleKey("- [ ] **Q3 LOW nothing re-verified yet on the page.** x")).toContain("re verified");
  });

  it("docs/OPEN.md holds no two OPEN items for one problem (exact zero)", () => {
    const md = readFileSync(join(ROOT, "docs/OPEN.md"), "utf8");
    const open = md.split("\n").filter((l) => /^- \[[ ~]\] \*\*Q\d+/.test(l));
    expect(open.length).toBeGreaterThan(100);
    expect(open.filter((l) => itemTitleKey(l)).length).toBeGreaterThan(100);
    expect(openTitleDuplicates(md), "merge the later item into the earlier one (tick it 'merged into Qn' and move its feed: tags)").toEqual([]);
  });

  it("short heads say too little to call two items one", () => {
    expect(itemOriginKey("- [ ] **Q1 Fix it.** soon")).toBeNull();
    expect(duplicateItems(["- [ ] **Q1 Fix it.** soon", "- [x] **Q2 Fix it.** soon"].join("\n"))).toEqual([]);
  });
});
