// @mutate docs/OPEN.md | - [ ] **Q7 MEDIUM WebKit only | - [~] **Q7 MEDIUM WebKit only
// @mutate docs/OPEN.md | select count(*) > 0 from tips where payment_status = 'paid' | select public.check_push_token_health() is not null from tips where payment_status = 'paid'
// @mutate scripts/open-done-when.mjs | const PARTLY = /^- \[~\] /; | const PARTLY = /^- \[x\] /;
// @mutate scripts/open-done-when.mjs | { kind: "issue", re: /^issue\s+#(\d+)\s+closed\b/ } | { kind: "issue", re: /^issue\s+#(\d+)\s+opened\b/ }
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
import { partlyDoneItems, rowText } from "../../scripts/open-done-when.mjs";
import { readdirSync } from "./helpers/trackedFiles";

const ROOT = join(__dirname, "..", "..");
const OPEN_MD = readFileSync(join(ROOT, "docs", "OPEN.md"), "utf8");

/** `[~]` items in docs/OPEN.md with no done-when marker, measured 2026-10-02 after the LOW branch rebased: 21 (four new "FIXED 2026-10-02, protection pending" lines whose last step is a 375 screenshot, which no marker kind can express); 19 after Q73 and Q387 were ticked done (combined landing #2087); 15 after rebasing onto origin/main 2026-10-02; 18 after three stranded notes landed (Q858 waits on Q785; Complete Profile and My Posts wait on a 375 screenshot); 17 after pd-b gave one a marker; 24 on 2026-10-03 after the lead removed seven markers that held while their items' own remaining work did not (Q71, Q104, Q380, Q416, Q421, Q593, Q701; each line says why); 20 on 2026-10-03 after Q340 got its done-when marker (lane B).; 22 on 2026-10-03 after the perf lane marked Q1157 and Q1158 fixed-and-waiting: what is left of each is Vercel Speed Insights' real-user P75 after deploy, which no marker kind can read (no API) */
// 24 on 2026-10-04: Q654 and Q1172 are fixed in part and wait on the lead's real-browser filmstrip, 375 LCP/FCP and Lighthouse, which no marker kind can express (merging the PR is not "done").
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
        m.kind !== "sql"
          ? []
          : [...String(m.query).matchAll(/(?:public\.)?(\w+)\s*\(/gi)]
              .map((x) => x[1].toLowerCase())
              .filter((name) => fns.has(name))
              .map((name) => `${i.id}: ${name}()`),
      ),
    );
    expect(bad).toEqual([]);
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
