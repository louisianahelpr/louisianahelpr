/**
 * nightly-red #2668 (2026-10-12): the nightly backup proves it holds EVERY table
 * that has rows on prod, measured on prod right before and right after the
 * dump, instead of asserting that five named tables always have rows.
 *
 * Class stopped, both directions:
 *   - a dump that silently drops a table whose rows exist (any table, not five)
 *     goes red;
 *   - a table that is truly empty on prod (public.messages after the 2026-10-09
 *     seed cleanup) no longer turns a faithful backup red for days;
 *   - the marketplace/login tables still go red when prod itself is empty;
 *   - a stale EXCLUDED_TABLES entry cannot hide a gap.
 *
 * @mutate scripts/lib/backupCoverage.mjs | if (inDump) { covered++; verdict = "ok"; } | if (true) { covered++; verdict = "ok"; }
 * @mutate scripts/lib/backupCoverage.mjs | else if (!(before.get(t) > 0) \|\| !(after.get(t) > 0)) problems.push | else if (false) problems.push
 * @mutate scripts/lib/backupCoverage.mjs | if (inDump) problems.push(`${t} is in EXCLUDED_TABLES | if (false) problems.push(`${t} is in EXCLUDED_TABLES
 * @mutate .github/workflows/db-backup.yml | if ! node scripts/backup-coverage.mjs verify counts-before.json counts-after.json out/data.sql; then | if false; then
 * @mutate .github/workflows/db-backup.yml | node scripts/backup-coverage.mjs count counts-after.json | true
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkCoverage, countsFrom, dumpedTables, COUNT_SQL, MUST_HAVE_ROWS, EXCLUDED_TABLES } from "../../scripts/lib/backupCoverage.mjs";

const ROOT = resolve(__dirname, "..", "..");
/** YAML with its whole-line `#` comments dropped, so a commented-out step never counts. */
const yaml = (p: string) => readFileSync(resolve(ROOT, p), "utf8").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
const counts = (o: Record<string, number>) => new Map(Object.entries(o));

const PROD = { "auth.users": 80, "public.profiles": 80, "public.jobs": 227, "public.applications": 68, "public.messages": 220, "public.tips": 0 };
const DUMP = [
  'INSERT INTO "auth"."users" ("id") VALUES',
  "\t('a'),",
  "\t('b');",
  'INSERT INTO "public"."profiles" ("id") VALUES (\'a\');',
  'INSERT INTO "public"."jobs" ("id") VALUES (\'j\');',
  'INSERT INTO "public"."applications" ("id") VALUES (\'x\');',
  'INSERT INTO "public"."messages" ("id", "content") VALUES (\'m\', \'quoted INSERT INTO "public"."tips" text\');',
].join("\n");

describe("backup coverage: every table with rows on prod is in data.sql", () => {
  it("parses one table per statement-start, never a quoted INSERT inside a value", () => {
    expect([...dumpedTables(DUMP)].sort()).toEqual(["auth.users", "public.applications", "public.jobs", "public.messages", "public.profiles"]);
  });

  it("passes a faithful dump", () => {
    const r = checkCoverage({ before: counts(PROD), after: counts(PROD), dumped: dumpedTables(DUMP), excluded: {} });
    expect(r.problems).toEqual([]);
    expect(r.withRows).toBe(5);
    expect(r.covered).toBe(5);
  });

  it("fails when prod has messages but the dump lost them (the failure the old check existed for)", () => {
    const lost = DUMP.split("\n").filter((l) => !l.includes('"public"."messages"')).join("\n");
    const r = checkCoverage({ before: counts(PROD), after: counts(PROD), dumped: dumpedTables(lost), excluded: {} });
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatch(/public\.messages has rows on prod \(220 before the dump, 220 after\) but data\.sql has no INSERT/);
  });

  it("fails for ANY table with rows that the dump dropped, not only a named few", () => {
    const prod = { ...PROD, "public.cron_catchup_policy": 26 };
    const r = checkCoverage({ before: counts(prod), after: counts(prod), dumped: dumpedTables(DUMP), excluded: {} });
    expect(r.problems.join("\n")).toMatch(/public\.cron_catchup_policy has rows on prod/);
  });

  it("does not fail a faithful backup of a table that is truly empty on prod (#2668: messages, 2026-10-09..11)", () => {
    const empty = { ...PROD, "public.messages": 0 };
    const noMessages = DUMP.split("\n").filter((l) => !l.includes('"public"."messages"')).join("\n");
    const r = checkCoverage({ before: counts(empty), after: counts(empty), dumped: dumpedTables(noMessages), excluded: {} });
    expect(r.problems).toEqual([]);
    expect(r.lines.find((l) => l.startsWith("public.messages"))).toMatch(/empty on prod before and after the dump/);
  });

  it("still fails when a marketplace/login table is empty ON PROD: that is data loss", () => {
    for (const t of MUST_HAVE_ROWS) {
      const prod = { ...PROD, [t]: 0 };
      const r = checkCoverage({ before: counts(prod), after: counts(prod), dumped: dumpedTables(DUMP), excluded: {} });
      expect(r.problems.join("\n")).toMatch(new RegExp(`${t.replace(".", "\\.")} is EMPTY on prod`));
    }
    expect(MUST_HAVE_ROWS).toEqual(expect.arrayContaining(["auth.users", "public.profiles", "public.jobs", "public.applications"]));
  });

  it("reports, not fails, a table whose count changed sign during the dump", () => {
    const r = checkCoverage({ before: counts(PROD), after: counts({ ...PROD, "public.tips": 3 }), dumped: dumpedTables(DUMP), excluded: {} });
    expect(r.problems).toEqual([]);
    expect(r.notes.join("\n")).toMatch(/public\.tips: changed during the dump \(0 -> 3\)/);
  });

  it("EXCLUDED_TABLES is exact both ways: a dumped or vanished entry fails", () => {
    const dumpedButExcluded = checkCoverage({ before: counts(PROD), after: counts(PROD), dumped: dumpedTables(DUMP), excluded: { "public.messages": "test" } });
    expect(dumpedButExcluded.problems.join("\n")).toMatch(/public\.messages is in EXCLUDED_TABLES but data\.sql carries it/);
    const vanished = checkCoverage({ before: counts(PROD), after: counts(PROD), dumped: dumpedTables(DUMP), excluded: { "public.gone": "test" } });
    expect(vanished.problems.join("\n")).toMatch(/public\.gone is in EXCLUDED_TABLES but no longer exists/);
    for (const reason of Object.values(EXCLUDED_TABLES)) expect(reason.length).toBeGreaterThan(20);
  });

  it("rejects an empty or malformed count result instead of treating it as 'nothing to check'", () => {
    expect(() => countsFrom([])).toThrow(/no rows/);
    expect(() => countsFrom({ message: "error" })).toThrow(/no rows/);
    expect(() => countsFrom([{ t: "public.jobs", n: "x" }])).toThrow(/bad count row/);
    expect(countsFrom([{ t: "public.jobs", n: "3" }]).get("public.jobs")).toBe(3);
  });

  it("the count query covers every table in public and auth, partitions folded into their parent", () => {
    expect(COUNT_SQL).toMatch(/nspname in \('public', 'auth'\)/);
    expect(COUNT_SQL).toMatch(/relkind in \('r', 'p'\) and not c\.relispartition/);
  });

  it("db-backup.yml counts prod before and after the data dump and fails the run on a gap", () => {
    const wf = yaml(".github/workflows/db-backup.yml");
    const before = wf.indexOf("node scripts/backup-coverage.mjs count counts-before.json");
    const dump = wf.indexOf("dump --data-only -f out/data.sql");
    const after = wf.indexOf("node scripts/backup-coverage.mjs count counts-after.json");
    expect(before).toBeGreaterThan(-1);
    expect(dump).toBeGreaterThan(before);
    expect(after).toBeGreaterThan(dump);
    expect(wf).toMatch(/if ! node scripts\/backup-coverage\.mjs verify counts-before\.json counts-after\.json out\/data\.sql; then\n[^\n]*\n\s*FAIL=1/);
    // The counts never ride into the encrypted archive.
    expect(wf).toMatch(/tar czf "backup-\$STAMP\.tar\.gz" -C out roles\.sql schema\.sql data\.sql cron\.sql storage-policies\.sql storage\n/);
  });
});
