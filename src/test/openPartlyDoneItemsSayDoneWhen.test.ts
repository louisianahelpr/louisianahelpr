// @mutate docs/OPEN.md | - [ ] **Q1368 LOW At launch, revisit | - [~] **Q1368 LOW At launch, revisit
// @mutate scripts/open-done-when.mjs |     .filter((name) => appFns.has(name)); |     .filter((name) => !appFns.has(name));
// @mutate scripts/open-done-when.mjs | const PARTLY = /^- \[~\] /; | const PARTLY = /^- \[x\] /;
// @mutate scripts/open-done-when.mjs | { kind: "issue", re: /^issue\s+#(\d+)\s+closed\b/ } | { kind: "issue", re: /^issue\s+#(\d+)\s+opened\b/ }
// @mutate scripts/lib/openFeeds.mjs | const keepMarkerless = target.state === "~" && | const keepMarkerless = false &&
/*
 * A `[~]` item that nobody re-checks stays `[~]` forever.
 *
 * 2026-09-27: eight partly-done items (Q399, Q348, Q298, Q423, Q342, Q343,
 * Q398, Q452) each said "tick after db-deploy once `SELECT ...` returns X";
 * all eight were already true on prod and were ticked only when someone
 * happened to re-run them by hand (commit daa403bf7). A `[~]` item now carries
 * `done-when:` markers (syntax: top of docs/OPEN.md) that
 * scripts/open-done-when.mjs runs nightly (.github/workflows/open-done-when.yml).
 *
 * This guard ratchets the number of `[~]` items WITHOUT a marker. The baseline
 * is exact: adding a markerless `[~]` fails, and so does giving one a marker
 * (or ticking one) without lowering the baseline in the same commit.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appFunctionsCalled, partlyDoneItems, rowText } from "../../scripts/open-done-when.mjs";
import { readdirSync } from "./helpers/trackedFiles";
import { applyFeeds } from "../../scripts/lib/openFeeds.mjs";

const ROOT = join(__dirname, "..", "..");
const OPEN_MD = readFileSync(join(ROOT, "docs", "OPEN.md"), "utf8");

/** `[~]` items in docs/OPEN.md with no done-when marker, measured 2026-10-02 after the LOW branch rebased: 21 (four new "FIXED 2026-10-02, protection pending" lines whose last step is a 375 screenshot, which no marker kind can express); 19 after Q73 and Q387 were ticked done (combined landing #2087); 15 after rebasing onto origin/main 2026-10-02; 18 after three stranded notes landed (Q858 waits on Q785; Complete Profile and My Posts wait on a 375 screenshot); 17 after pd-b gave one a marker; 24 on 2026-10-03 after the lead removed seven markers that held while their items' own remaining work did not (Q71, Q104, Q380, Q416, Q421, Q593, Q701; each line says why); 20 on 2026-10-03 after Q340 got its done-when marker (lane B).; 22 on 2026-10-03 after the perf lane marked Q1157 and Q1158 fixed-and-waiting: what is left of each is Vercel Speed Insights' real-user P75 after deploy, which no marker kind can read (no API) */
// 24 on 2026-10-04: Q654 and Q1172 are fixed in part and wait on the lead's real-browser filmstrip, 375 LCP/FCP and Lighthouse, which no marker kind can express (merging the PR is not "done").
// 26 on 2026-10-05: the money lane's Q805 (chargeback follow-ups wait on a Stripe test-mode dispute run and the owner's webhook secret) and Q1336 (waits on the owner subscribing the live endpoint to charge.refund.updated) are fixed in part; neither wait is something a done-when marker can read.
// 23 on 2026-10-05: Q430 got its done-when marker (issue #2213, the loading-states-refresh fixture run); its burst half was measured green.
// 25 once both land: 26 (Q805, Q1336) minus Q430's new marker.
// 26 on 2026-10-05 (money lane): Q362's urgent-bonus half is built; what is left is a live paid tip read in Stripe and an owner Terms call, neither of which a marker can read.
// 26 on 2026-10-05 (crews lane): Q707 waits on a prod re-shot after deploy (no marker kind reads a screenshot); Q731, Q729, Q1282 carry sql markers.
// 27 on 2026-10-05 (crews lane): Q780 reviewed; what is left waits on Q1382 (the crew member UI) and its screenshots, which no marker kind can read.
// 28 with both lanes landed together (money Q362 + crews Q707/Q780).
// 29 on 2026-10-05 (lead): Q1385 waits on a live check by a second account after deploy; no marker kind reads that.
// 28 on 2026-10-05 (lead tick): Q1385 left the markerless set when it was verified live.
// 27 on 2026-10-05 (lead tick 2): Q1336 verified live left the markerless set.
// 33 on 2026-10-05 (batch 2): Q1313 (Notify Me live push check), Q1398 + Q1399 (offer cards: live hire and phone look), Q1408 (old-build floor: needs a new TestFlight build) all wait on live or device checks no marker kind reads.
// 31 rebased on main's ticks (27 there + batch 2's 4).
// 32 on 2026-10-05 (Q1378 lane): Q1378 is built but waits on the money/authz reviews and a prod re-shot after deploy (no marker kind reads either).
// 33 on 2026-10-05 (Q1378 lane): Q1409 built, waits on reviews, deploy and a prod re-shot (no marker kind reads those).
// 34 on 2026-10-05 (Q1378 lane): Q709 (c) built, waits on a screenshot of a real completed crew card.
// 35 on 2026-10-06 (lead): Q390 (Keychain session) is built and reviewed; what is left is a TestFlight build and a real-device check (sign in, relaunch, Offload App, sign out then relaunch), which no marker kind can read.
// 34 on 2026-10-06 (batch landing): Q1408 was ticked (24 h clean after min build 7115), leaving the markerless set.
// 26 on 2026-10-07 (lane-product, rebased on main's 28): Q333 and Q335 ticked (their screenshot halves done on prod), leaving the markerless set.
// 23 on 2026-10-07 (HIGH lane, landing agent/high4-q1421-q1398, rebased on 24): Q1398 ticked.
// 24 on 2026-10-07: Q913 (Money-B batch 3) is fixed and waits on the press spec run and a look at the six admin ✕s at 375 and 1440, which no marker kind can express.
const MARKERLESS_PARTLY_DONE = 24;

describe("[~] items say when they are done", () => {
  const items = partlyDoneItems(OPEN_MD);

  it("reads the real queue (floor)", () => {
    expect(items.length).toBeGreaterThan(20);
  });

  it("markerless [~] count is exactly the baseline (lower it when you add a marker or tick one)", () => {
    const markerless = items.filter((i) => i.markers.length === 0 && i.malformed.length === 0);
    expect(markerless.length, markerless.map((i) => i.id).join(", ")).toBe(MARKERLESS_PARTLY_DONE);
  });

  // 2026-09-28 (#1951, open-done-when run 36365813029): the Q82 marker called
  // public.check_push_token_health() and the nightly failed with "permission
  // denied for function". The Management API's read_only:true runs as
  // supabase_read_only_user, which (measured on prod with has_function_privilege)
  // may execute 5 of 435 public functions. A marker reads tables, never an app
  // function. Inventory: every function any migration creates.
  it("no sql marker calls an app function (the read-only role cannot execute them)", () => {
    const migDir = join(ROOT, "supabase", "migrations");
    const fns = new Set<string>();
    for (const f of readdirSync(migDir).filter((n) => n.endsWith(".sql"))) {
      const sqlText = readFileSync(join(migDir, f), "utf8");
      for (const m of sqlText.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?(\w+)"?\s*\(/gi)) {
        fns.add(m[1].toLowerCase());
      }
    }
    expect(fns.size, "read no functions from supabase/migrations").toBeGreaterThan(200);
    const bad = items.flatMap((i) =>
      i.markers.flatMap((m) =>
        m.kind !== "sql" ? [] : appFunctionsCalled(String(m.query), fns).map((name) => `${i.id}: ${name}()`),
      ),
    );
    expect(bad).toEqual([]);
    // The check itself, on fixed queries: OPEN.md's own markers change every
    // day, and a mutation of one went vacuous when its item left [~]
    // (vacuity 37262748113, 2026-10-05, Q788).
    expect(appFunctionsCalled("select public.check_push_token_health() is not null", fns)).toEqual(["check_push_token_health"]);
    expect(appFunctionsCalled("select count(*) > 0 from tips where payment_status = 'paid'", fns)).toEqual([]);
  });

  it("every done-when marker in OPEN.md parses", () => {
    const bad = items.flatMap((i) => i.malformed.map((m) => `${i.id}: done-when: ${m}`));
    expect(bad).toEqual([]);
  });
});

describe("done-when marker parser", () => {
  const md = [
    "- [~] **Q1 sql** done-when: sql `SELECT roles::text || '|' || cmd FROM pg_policies` => `{authenticated}|UPDATE` and",
    "  continued; done-when: sql `select count(*) from t` => 0.",
    "- [~] **Q2 test** done-when: test src/test/foo.test.ts",
    "- [ ] **Q3 open item** done-when: issue #5 closed",
    "- [~] **Q4 gh** done-when: issue #12 closed, done-when: pr #34 merged, done-when: bus NB-004 closed",
    "## heading",
    "- [~] **Q5 bad** done-when: soon",
  ].join("\n");
  const byId = Object.fromEntries(partlyDoneItems(md).map((i) => [i.id, i]));

  it("reads only [~] items, with continuation lines", () => {
    expect(Object.keys(byId)).toEqual(["Q1", "Q2", "Q4", "Q5"]);
    expect(byId.Q1.markers).toEqual([
      { kind: "sql", query: "SELECT roles::text || '|' || cmd FROM pg_policies", expected: "{authenticated}|UPDATE" },
      { kind: "sql", query: "select count(*) from t", expected: "0" },
    ]);
  });

  it("parses test, issue, pr and bus markers", () => {
    expect(byId.Q2.markers).toEqual([{ kind: "test", path: "src/test/foo.test.ts" }]);
    expect(byId.Q4.markers).toEqual([
      { kind: "issue", number: 12 },
      { kind: "pr", number: 34 },
      { kind: "bus", id: "NB-004" },
    ]);
  });

  it("an unparseable marker is reported, never skipped", () => {
    expect(byId.Q5.markers).toEqual([]);
    expect(byId.Q5.malformed).toHaveLength(1);
  });

  it("compares one column only (transports order columns differently)", () => {
    expect(rowText([{ c: ["authenticated"] }])).toBe("{authenticated}");
    expect(rowText([{ n: 0 }])).toBe("0");
    expect(rowText([])).toBe("(no rows)");
    expect(() => rowText([{ a: 1, b: 2 }])).toThrow(/exactly one column/);
  });
});

// #2423 (2026-10-06): the scoreboard refresh PR was red on the exact baseline
// above because open-sync-trackers gave a markerless [~] item (Q593, marker
// removed by the lead on purpose) a done-when marker when its tagged ledger
// row moved to a new nightly-red issue. The sync is the only writer of feed
// markers, and it runs unattended: it must never move this baseline.
describe("the feed sync never moves the markerless [~] baseline", () => {
  const md = [
    "- [~] **Q90 MEDIUM fixtures, marker removed on purpose.** feed: ledger abcdef123456.",
    "- [~] **Q91 MEDIUM has a marker.** feed: ledger 111111111111. done-when: issue #7 closed",
    "- [ ] **Q92 MEDIUM open item.** feed: ledger 222222222222.",
  ].join("\n");
  const groups = [
    { keys: ["issue #8001", "ledger abcdef123456"], title: "nightly-red: a is red", origin: "o", markers: ["done-when: issue #8001 closed", "done-when: sql `select 1` => 1"] },
    { keys: ["issue #8002", "ledger 111111111111"], title: "nightly-red: b is red", origin: "o", markers: ["done-when: issue #8002 closed", "done-when: sql `select 2` => 2"] },
    { keys: ["issue #8003", "ledger 222222222222"], title: "nightly-red: c is red", origin: "o", markers: ["done-when: issue #8003 closed", "done-when: sql `select 3` => 3"] },
  ];
  const out = applyFeeds(md, groups, { status: () => "open", nextFree: 9000, today: "2026-10-06" });
  const line = (id: string) => out.md.split("\n").find((l) => l.includes(`**${id} `)) ?? "";
  const markerless = (text: string) => partlyDoneItems(text).filter((i) => i.markers.length === 0).map((i) => i.id);

  it("attaches the new feed tag to every tagged item (nothing is filed twice)", () => {
    expect(out.attached.map((a: { id: string }) => a.id)).toEqual(["Q90", "Q91", "Q92"]);
    expect(out.created).toEqual([]);
    expect(line("Q90")).toContain("feed: issue #8001");
  });

  it("a markerless [~] item stays markerless; the others get the markers", () => {
    expect(markerless(out.md)).toEqual(markerless(md));
    expect(markerless(out.md)).toEqual(["Q90"]);
    expect(line("Q90")).not.toContain("done-when:");
    expect(line("Q91")).toContain("done-when: issue #8002 closed");
    expect(line("Q92")).toContain("done-when: issue #8003 closed");
  });
});
