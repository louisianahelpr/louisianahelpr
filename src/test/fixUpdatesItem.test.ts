/*
 * GUARD (docs/OPEN.md Q1150): a commit that names an open item updates that
 * item in the same landing. Owner, 2026-10-03: "make sure done work is ticked
 * off ... make sure it doesn't happen again". e952452d7 fixed Q572 and Q445
 * and neither line moved, so the open count overstated the work for a day.
 * Pins the rules on fixtures, drives the real CLI on a fixture repo (red on
 * the e952452d7 shape), and pins the wiring: land.sh and the required
 * "Lint, type-check, build, test" job both run it with --strict.
 */
// @mutate scripts/lib/fixUpdatesItem.mjs | if (!item?.open) continue; | if (!item) continue;
// @mutate scripts/lib/fixUpdatesItem.mjs | if (was.get(id)?.text !== item.text && onTip.get(id)?.text !== item.text) continue; | if (was.get(id)?.text !== item.text) continue;
// @mutate scripts/lib/fixUpdatesItem.mjs | if (was.get(id)?.text !== item.text && onTip.get(id)?.text !== item.text) continue; | continue;
// @mutate scripts/lib/fixUpdatesItem.mjs | const TRAILER = /^(?:Fixes\|Closes):\s*(.+)$/gim; | const TRAILER = /^(?:Never):\s*(.+)$/gim;
// @mutate scripts/lib/fixUpdatesItem.mjs | if (hi > lo && hi - lo <= MAX_RANGE) | if (false)
// @mutate scripts/lib/fixUpdatesItem.mjs | if (cur && cur.committed === c.committed) cur.commits.push(c); | if (false) cur.commits.push(c);
// @mutate scripts/check-fixes-update-their-items.mjs | if (strict && rows.length) process.exit(1); | if (false) process.exit(1);
// @mutate scripts/land.sh | node scripts/check-fixes-update-their-items.mjs --range origin/main..HEAD --strict | true
// @mutate .github/workflows/test.yml | node scripts/check-fixes-update-their-items.mjs --range "$BASE..$HEAD_SHA" --strict | node scripts/check-fixes-update-their-items.mjs --range "$BASE..$HEAD_SHA"
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, realpathSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain .mjs module, no declaration file
import { itemBlocks, namedIn, claimedItems, unrecordedItems, parseCommits, groupLandings, MAX_RANGE } from "../../scripts/lib/fixUpdatesItem.mjs";

const ROOT = join(__dirname, "..", "..");
const CLI = join(ROOT, "scripts", "check-fixes-update-their-items.mjs");

const md = (...items: string[]) => ["# Open", "", "## QUEUE", ...items, "", "## Other", "- [ ] **Q9 LOW unrelated.**", ""].join("\n");
const Q572 = "- [ ] **Q572 MEDIUM anon storage listing errors.** found 2026-09-28.";
const Q445 = "- [ ] **Q445 LOW web social sign-in notices.**\n  continuation line of Q445";

describe("which items a commit names", () => {
  it("reads every form the subjects on main use", () => {
    expect(namedIn("fix(auth,storage): anon storage listing errors (Q572); web social sign-in notices (Q445)").sort()).toEqual(["Q445", "Q572"]);
    expect(namedIn("verify Q1135/Q1137 when green").sort()).toEqual(["Q1135", "Q1137"]);
    expect(namedIn("fix(Q210b): crew clawback")).toEqual(["Q210"]);
    expect(namedIn("tick Q906 and Q916").sort()).toEqual(["Q906", "Q916"]);
    expect(namedIn("Q872-Q875 notices").sort()).toEqual(["Q872", "Q873", "Q874", "Q875"]);
    expect(namedIn("Q333–Q335 (en dash)").sort()).toEqual(["Q333", "Q334", "Q335"]);
    expect(namedIn("Q333-335 shorthand").sort()).toEqual(["Q333", "Q334", "Q335"]);
  });

  it("does not expand a renumber sweep or a backwards range, and ignores look-alikes", () => {
    expect(namedIn(`renumber Q1-Q${2 + MAX_RANGE}`).sort()).toEqual(["Q1", `Q${2 + MAX_RANGE}`]);
    expect(namedIn("Q1043-5")).toEqual(["Q1043"]);
    expect(namedIn("SQ12 FAQ3 no items")).toEqual([]);
  });

  it("claims the subject and Fixes:/Closes: trailers, not prose in the body", () => {
    expect(claimedItems({ subject: "fix: thing (Q1)", body: "see also Q2 for context" })).toEqual(["Q1"]);
    expect(claimedItems({ subject: "fix: thing", body: "why\n\nFixes: Q3, Q4\nCloses: Q5" }).sort()).toEqual(["Q3", "Q4", "Q5"]);
  });
});

describe("item blocks", () => {
  it("runs a block to the next item or heading and records open/done", () => {
    const b = itemBlocks(md(Q572, Q445, "- [x] **Q7 done.**", "- [~] **Q8 partly.**"));
    expect(b.get("Q445").text).toContain("continuation line of Q445");
    expect(b.get("Q445").text).not.toContain("Q7");
    expect(b.get("Q7").open).toBe(false);
    expect(b.get("Q8").open).toBe(true);
    expect(b.get("Q9").text).not.toContain("Q8");
  });

  it("keeps both items of a duplicated number", () => {
    const b = itemBlocks(md("- [x] **Q5 first.**", "- [ ] **Q5 second.**"));
    expect(b.get("Q5").open).toBe(true);
    expect(b.get("Q5").text).toContain("first");
    expect(b.get("Q5").text).toContain("second");
  });
});

describe("which named items a landing left untouched", () => {
  const fix = { sha: "e952452d7", subject: "fix(auth,storage): anon storage listing errors (Q572); web social sign-in notices without a marker (Q445)", body: "" };
  const before = md(Q572, Q445);

  it("is red on e952452d7: both items stayed `- [ ]`, word for word", () => {
    expect(unrecordedItems([fix], before, before).map((r: { id: string }) => r.id).sort()).toEqual(["Q445", "Q572"]);
  });

  it("a tick, an archive move or a STATUS note each count as the update", () => {
    const ticked = md(Q572.replace("- [ ]", "- [x]"), Q445 + "\n  STATUS 2026-10-03: fixed in e952452d7; marker pending.");
    expect(unrecordedItems([fix], before, ticked)).toEqual([]);
    const archived = md(Q445 + " STATUS: done-when marker added.");
    expect(unrecordedItems([fix], before, archived)).toEqual([]);
  });

  it("an item already done before the landing asks for nothing", () => {
    const done = md("- [x] **Q572 MEDIUM anon storage listing errors.** Guard: src/test/x.test.ts", Q445.replace("- [ ]", "- [x]"));
    expect(unrecordedItems([fix], done, done)).toEqual([]);
  });

  it("a whitespace-only edit is not an update", () => {
    const reflowed = md(Q572.replace(" found", "\n    found"), Q445.replace("continuation line", "continuation  line"));
    expect(unrecordedItems([fix], before, reflowed).length).toBe(2);
  });

  it("main's edit to the item, merged into the branch, is not the landing's", () => {
    const onMain = md(Q572 + " STATUS (main): someone else's note.", Q445);
    expect(unrecordedItems([fix], before, onMain, onMain).map((r: { id: string }) => r.id).sort()).toEqual(["Q445", "Q572"]);
  });

  it("an item the landing creates counts as touched", () => {
    const filed = { sha: "c639d8e7b", subject: "docs(open): Q1146 the 31 local branches", body: "" };
    expect(unrecordedItems([filed], before, md(Q572, Q445, "- [ ] **Q1146 LOW new.**"))).toEqual([]);
  });
});

describe("landings on main", () => {
  it("groups a rebase merge's commits by their shared committer time, oldest landing first", () => {
    const raw = [
      ["c3", "chore: refresh", "", "c2", "200"],
      ["c2", "docs(open): Q1", "", "c1", "200"],
      ["c1", "fix: x (Q1)", "", "b9", "200"],
      ["b9", "fix: y", "", "b8", "100"],
    ].map((f) => f.join("\x1f")).join("\x1e") + "\x1e";
    const landings = groupLandings(parseCommits(raw));
    expect(landings.map((l: { base: string; head: string }) => [l.base, l.head])).toEqual([["b8", "b9"], ["b9", "c3"]]);
    expect(landings[1].commits.map((c: { sha: string }) => c.sha)).toEqual(["c3", "c2", "c1"]);
  });
});

describe("the CLI on a fixture repo", () => {
  let repo = "";
  const ENV = {
    GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@e", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@e",
    GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0",
  };
  const git = (...a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8", env: { ...process.env, ...ENV } }).trim();
  const commit = (message: string, open?: string) => {
    if (open !== undefined) writeFileSync(join(repo, "docs/OPEN.md"), open);
    else writeFileSync(join(repo, "src.txt"), String(Math.random()));
    git("add", "-A");
    git("-c", "commit.gpgsign=false", "commit", "-q", "-m", message);
    return git("rev-parse", "HEAD");
  };
  const run = (range: string) => {
    const r = spawnSync(process.execPath, [CLI, "--range", range, "--strict"], { cwd: repo, encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...ENV } });
    return { status: r.status, out: r.stdout + r.stderr };
  };
  let base = "";

  beforeAll(() => {
    repo = realpathSync(mkdtempSync(join(tmpdir(), "fix-updates-item-")));
    git("init", "-q", "-b", "main");
    mkdirSync(join(repo, "docs"));
    base = commit("docs(open): queue", md(Q572, Q445));
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it("fails a landing whose fix names an item it never updates, and names the item", () => {
    commit("fix(storage): anon storage listing errors (Q572)");
    const r = run(`${base}..HEAD`);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("| Q572 |");
    expect(r.out).not.toContain("| Q445 |");
  });

  it("passes once the same landing updates the item", () => {
    commit("docs(open): Q572 STATUS", md(Q572 + "\n  STATUS 2026-10-03: listing errors fixed; tick after the deploy.", Q445));
    const r = run(`${base}..HEAD`);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain("0 named item(s) still open and untouched");
  });
});

describe("wiring", () => {
  it("land.sh refuses the push, after the rebase and refresh", () => {
    const land = readFileSync(join(ROOT, "scripts/land.sh"), "utf8");
    const at = land.indexOf("node scripts/check-fixes-update-their-items.mjs --range origin/main..HEAD --strict");
    expect(at).toBeGreaterThan(land.indexOf("npm run -s check:generated"));
  });

  it("the required Test job runs it with --strict on every PR and push", () => {
    const wf = readFileSync(join(ROOT, ".github/workflows/test.yml"), "utf8");
    expect(wf).toContain('node scripts/check-fixes-update-their-items.mjs --range "$BASE..$HEAD_SHA" --strict');
    expect(wf).toMatch(/name: Lint, type-check, build, test/);
  });
});
