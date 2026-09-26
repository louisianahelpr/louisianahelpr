/*
 * GUARD (docs/OPEN.md Q16): docs/OPEN.md holds live items only; done items are
 * archived VERBATIM to docs/archive/OPEN-done-YYYY-MM.md, and every queue tool
 * still reads the archive (counts, next free number, duplicate numbers, the
 * guard-named check), so archiving can never change the score or reuse a number.
 */
// @mutate scripts/lib/openQueue.mjs |   return names.filter((n) => ARCHIVE_RE.test(n)) |   return [].filter((n) => ARCHIVE_RE.test(n))
// @mutate scripts/lib/openQueue.mjs | .test(lines[i + 1])) block.push(lines[++i]); | .test(lines[i + 1])) i++;
// @mutate scripts/lib/openQueue.mjs | const DONE = /^- \[x\] /; | const DONE = /^- \[X\] /;
// @mutate scripts/lib/openQueue.mjs |     if (!DONE.test(l)) { kept.push(l); continue; } |     if (!DONE.test(l)) { continue; }
// @mutate scripts/archive-done.mjs |     process.exitCode = 1; |     process.exitCode = 0;
// @mutate scripts/queue-count.mjs |   const all = queueText("."); |   const all = md;
// @mutate scripts/scoreboard.mjs | queueCounts(queueText(REPO, read)) | queueCounts(read(OPEN))
// @mutate scripts/check-generated-current.mjs |     cmd: ["node", "scripts/archive-done.mjs", "--write"], |     cmd: ["node", "-e", ""],
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain .mjs module, no declaration file
import { queueText, splitDone, archiveFiles, appendToArchive, OPEN } from "../../scripts/lib/openQueue.mjs";
// @ts-expect-error — plain .mjs script, no declaration file
import { queueCounts } from "../../scripts/queue-count.mjs";
// @ts-expect-error — plain .mjs script, no declaration file
import { localRows } from "../../scripts/scoreboard.mjs";
// @ts-expect-error — plain .mjs script, no declaration file
import { GENERATED } from "../../scripts/check-generated-current.mjs";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const ids = (md: string, state: string) => [...md.matchAll(new RegExp(`^- \\[${state}\\] \\*\\*(Q\\d+)\\b`, "gm"))].map((m) => m[1]);

describe("this repo: OPEN.md is live items only, and the archive is still read", () => {
  const archives: string[] = archiveFiles(ROOT);
  const archived = archives.flatMap((p) => ids(read(p), "x"));

  it("has an archive with the done items (cannot pass vacuously)", () => {
    expect(archives.length).toBeGreaterThanOrEqual(1);
    expect(archived.length).toBeGreaterThan(200);
  });

  it("OPEN.md itself carries no done item (run `npm run inventories:refresh`)", () => {
    expect(read(OPEN).split("\n").filter((l: string) => /^- \[x\] /.test(l)).length).toBe(0);
  });

  it("every archived done item still counts as done in the queue score", () => {
    const all = queueText(ROOT);
    const done = new Set(ids(all, "x"));
    for (const id of archived) expect(done.has(id), id).toBe(true);
    expect(queueCounts(all).done).toBeGreaterThanOrEqual(archived.length);
  });

  it("the scoreboard's queue row counts the archive too", () => {
    const row = localRows().find((r: { signal: string }) => r.signal.startsWith("OPEN.md queue"));
    expect(row.pass).toBe(queueCounts(queueText(ROOT)).done);
  });

  it("archive-done runs before queue-count in check-generated-current", () => {
    const order = GENERATED.map((g: { id: string }) => g.id);
    expect(order.indexOf("archive-done")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("archive-done")).toBeLessThan(order.indexOf("queue-count"));
    expect(GENERATED.find((g: { id: string }) => g.id === "archive-done").cmd).toEqual(["node", "scripts/archive-done.mjs", "--write"]);
  });
});

describe("splitDone moves exactly the done blocks", () => {
  const md = [
    "## Queue",
    "- [ ] **Q1 open**",
    "  detail of Q1",
    "- [x] **Q2 done** GUARD: x.test.ts",
    "  more of Q2",
    "  and more",
    "2. **A numbered question** that is not part of the item above",
    "- [~] **Q3 partial**",
    "- [x] **Q4 done**",
    "",
    "  indented after a blank line stays",
  ].join("\n");

  it("takes the item line and its indented lines, nothing else", () => {
    const { kept, moved } = splitDone(md);
    expect(moved.map((m: { text: string }) => m.text)).toEqual(["- [x] **Q2 done** GUARD: x.test.ts\n  more of Q2\n  and more", "- [x] **Q4 done**"]);
    expect(moved[0].heading).toBe("Queue");
    expect(kept).toContain("2. **A numbered question**");
    expect(kept).toContain("  detail of Q1");
    expect(kept).toContain("  indented after a blank line stays");
    expect(kept).not.toMatch(/Q2|Q4/);
  });

  it("appends under a dated heading and keeps what was there", () => {
    const first = appendToArchive("", splitDone(md).moved, "2026-09-26");
    expect(first).toMatch(/^# Done queue items/);
    expect(first).toContain('## Archived 2026-09-26 — from "Queue"');
    const second = appendToArchive(first, [{ heading: "Other", text: "- [x] **Q9 z**" }], "2026-09-27");
    expect(second.startsWith(first.trimEnd())).toBe(true);
    expect(second).toContain("- [x] **Q9 z**");
  });
});

describe("the CLIs on a fixture repo", () => {
  let dir = "";
  const node = (script: string, ...a: string[]) => spawnSync(process.execPath, [join(ROOT, "scripts", script), ...a], {
    cwd: dir, encoding: "utf8", env: { PATH: process.env.PATH ?? "", LH_REPO_ROOT: dir, LH_ARCHIVE_DATE: "2026-09-26" },
  });
  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "lh-openq-")));
    mkdirSync(join(dir, "docs", "archive"), { recursive: true });
    writeFileSync(join(dir, "docs", "OPEN.md"), [
      "<!-- generated: queue-count (node scripts/queue-count.mjs --write) -->",
      "x",
      "<!-- /generated: queue-count -->",
      "## Q",
      "- [ ] **Q10 open**",
      "- [x] **Q11 done**",
      "  body",
      "",
    ].join("\n"));
    writeFileSync(join(dir, "docs", "archive", "OPEN-done-2026-08.md"), "# old\n- [x] **Q50 archived long ago**\n");
  });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("archive-done reports (exit 1), then --write moves the item and the score does not change", () => {
    const before = node("queue-count.mjs").stdout;
    expect(before).toContain("3 items — 2 done");
    expect(before).toContain("next free: Q51");
    expect(node("archive-done.mjs").status).toBe(1);
    expect(node("archive-done.mjs", "--write").status).toBe(0);
    expect(readFileSync(join(dir, "docs", "OPEN.md"), "utf8")).not.toContain("Q11");
    expect(readFileSync(join(dir, "docs", "archive", "OPEN-done-2026-09.md"), "utf8")).toContain("- [x] **Q11 done**\n  body");
    expect(node("archive-done.mjs").status).toBe(0);
    const after = node("queue-count.mjs").stdout;
    expect(after).toBe(before);
  });

  it("a number reused across OPEN.md and an archive is a duplicate", () => {
    writeFileSync(join(dir, "docs", "OPEN.md"), readFileSync(join(dir, "docs", "OPEN.md"), "utf8") + "- [ ] **Q50 reused**\n");
    const r = node("queue-count.mjs");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("DUPLICATE queue numbers: Q50");
  });
});
