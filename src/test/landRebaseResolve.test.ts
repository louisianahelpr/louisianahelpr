// @mutate scripts/land.sh |       if node scripts/lib/landRebaseResolve.mjs; then |       if false; then
// @mutate scripts/land.sh |   node scripts/lib/landRecount.mjs |   true
// @mutate scripts/lib/landRebaseResolve.mjs |     } else if (generated.has(file)) { |     } else if (false) {
// @mutate scripts/lib/landRebaseResolve.mjs |     if (!mo \|\| !mt \|\| mo[1] !== mt[1]) return null; |     if (!mo \|\| !mt) return null;
// @mutate scripts/lib/landRecount.mjs |         text = setConstant(text, name, measured); |         void measured;
/*
 * GUARD: land.sh's rebase settles the conflicts seven lanes landing at once
 * make (owner, 2026-10-07: every land.sh rebase stopped and looped on
 * docs/OPEN.md, its archive, the generated docs and the exact-count
 * constants). Driven with a REAL git rebase in a throwaway repository:
 * scripts/lib/landRebaseResolve.mjs must resolve all four kinds and stage
 * them, so `git rebase --continue` finishes; any other conflicted file is left
 * for a person. scripts/lib/landRecount.mjs then writes the count the guard
 * measures.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
// @ts-expect-error — plain .mjs module
import { resolveAll, resolveCountHunks } from "../../scripts/lib/landRebaseResolve.mjs";
// @ts-expect-error — plain .mjs module
import { measuredFrom, setConstant, recount } from "../../scripts/lib/landRecount.mjs";

const ROOT = join(__dirname, "..", "..");
let repo = "";
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
const put = (rel: string, text: string) => {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), text);
};
const read = (rel: string) => readFileSync(join(repo, rel), "utf8");
const quiet = () => {};

const open = (...items: string[]) => ["# Open list", "", ...items, "", "## Notes", ""].join("\n");
const archive = (...items: string[]) => ["# Done 2026-10", "", ...items, ""].join("\n");
const count = (n: number, comment: string) => `// header\n${comment}\nconst MARKERLESS = ${n};\nexport {};\n`;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "land-rebase-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  put("docs/OPEN.md", open("- [ ] **Q1 LOW alpha**", "- [ ] **Q2 LOW beta**"));
  put("docs/archive/OPEN-done-2026-10.md", archive("- [x] **Q0 LOW old**"));
  put("public/sitemap.xml", "<urlset>base</urlset>\n");
  put("src/test/count.test.ts", count(5, "// 5 at base"));
  put("notes.txt", "base\n");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  git("checkout", "-q", "-b", "lane");
  // the lane notes Q1, ticks Q2 into the archive, and moves the count and a generated file
  put("docs/OPEN.md", open("- [ ] **Q1 LOW alpha** **LANE:** note", "- [ ] **Q4 LOW lane's new**"));
  put("docs/archive/OPEN-done-2026-10.md", archive("- [x] **Q0 LOW old**", "- [x] **Q2 LOW beta** **DONE:** lane"));
  put("public/sitemap.xml", "<urlset>lane</urlset>\n");
  put("src/test/count.test.ts", count(6, "// 6 after the lane's item"));
  git("commit", "-q", "-am", "lane work");
  git("checkout", "-q", "main");
  // meanwhile main noted Q1 too, filed Q3, archived Q9, and moved the same count and file
  put("docs/OPEN.md", open("- [~] **Q1 LOW alpha** **MAIN:** built", "- [ ] **Q2 LOW beta**", "- [ ] **Q3 LOW main's new**"));
  put("docs/archive/OPEN-done-2026-10.md", archive("- [x] **Q0 LOW old**", "- [x] **Q9 LOW nine**"));
  put("public/sitemap.xml", "<urlset>main</urlset>\n");
  put("src/test/count.test.ts", count(7, "// 7 after main's item"));
  git("commit", "-q", "-am", "main work");
  git("checkout", "-q", "lane");
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

function rebaseStops() {
  try {
    git("rebase", "-q", "main");
    return false;
  } catch {
    return true;
  }
}

describe("land.sh rebase: the four conflict kinds resolve themselves", () => {
  it("OPEN.md, the archive, a generated file and a count constant: all resolved, the rebase finishes", async () => {
    expect(rebaseStops()).toBe(true);
    expect(git("diff", "--name-only", "--diff-filter=U").split("\n").filter(Boolean).sort()).toEqual(
      ["docs/OPEN.md", "docs/archive/OPEN-done-2026-10.md", "public/sitemap.xml", "src/test/count.test.ts"],
    );
    const { left } = await resolveAll({ cwd: repo, log: quiet });
    expect(left).toEqual([]);
    execFileSync("git", ["-c", "core.editor=true", "rebase", "--continue"], { cwd: repo, env: { ...process.env, GIT_EDITOR: "true" } });
    expect(existsSync(join(repo, ".git", "rebase-merge"))).toBe(false);

    // both sides' notes on Q1, the further status; Q2 ticked away (the lane's tick wins); both new items
    expect(read("docs/OPEN.md")).toBe(open("- [~] **Q1 LOW alpha** **MAIN:** built **LANE:** note", "- [ ] **Q3 LOW main's new**", "- [ ] **Q4 LOW lane's new**"));
    expect(read("docs/archive/OPEN-done-2026-10.md")).toBe(archive("- [x] **Q0 LOW old**", "- [x] **Q9 LOW nine**", "- [x] **Q2 LOW beta** **DONE:** lane"));
    // generated: main's copy (land.sh regenerates it next)
    expect(read("public/sitemap.xml")).toBe("<urlset>main</urlset>\n");
    // count: main's value now, both comments, and recorded for the recount
    expect(read("src/test/count.test.ts")).toBe("// header\n// 7 after main's item\n// 6 after the lane's item\nconst MARKERLESS = 7;\nexport {};\n");
    expect(JSON.parse(read(".git/land-recount.json"))).toEqual([{ file: "src/test/count.test.ts", name: "MARKERLESS" }]);
  });

  it("any other conflicted file is left for a person", async () => {
    put("notes.txt", "lane\n");
    git("commit", "-q", "-am", "lane notes");
    git("checkout", "-q", "main");
    put("notes.txt", "main\n");
    git("commit", "-q", "-am", "main notes");
    git("checkout", "-q", "lane");
    expect(rebaseStops()).toBe(true);
    // the first replayed commit's conflicts are all resolvable
    expect((await resolveAll({ cwd: repo, log: quiet })).left).toEqual([]);
    try {
      execFileSync("git", ["rebase", "--continue"], { cwd: repo, env: { ...process.env, GIT_EDITOR: "true" }, stdio: "pipe" });
    } catch {
      /* stops on the next commit: notes.txt */
    }
    expect((await resolveAll({ cwd: repo, log: quiet })).left).toEqual(["notes.txt"]);
  });

  it("a hunk that is not one count constant is not a count conflict", () => {
    const hunk = (o: string, t: string) => `a\n<<<<<<< HEAD\n${o}\n=======\n${t}\n>>>>>>> x\nb`;
    expect(resolveCountHunks(hunk("const A = 1;", "const A = 2;"))).toEqual({ text: "a\nconst A = 1;\nb", names: ["A"] });
    expect(resolveCountHunks(hunk("const A = 1;", "const B = 2;"))).toBeNull();
    expect(resolveCountHunks(hunk("doThing();", "doOther();"))).toBeNull();
  });
});

describe("landRecount: the guard's own measurement is written", () => {
  it("reads vitest's 'expected <measured> to be <constant>' and writes it", () => {
    expect(measuredFrom("AssertionError: expected 31 to be 30 // Object.is equality", 30)).toBe(31);
    expect(measuredFrom("expected 31 to be 29", 30)).toBeNull();
    expect(setConstant("x\nconst MARKERLESS = 7;\n", "MARKERLESS", 9)).toBe("x\nconst MARKERLESS = 9;\n");
  });

  it("recount() rewrites the recorded constant until its guard is green, then clears the record", () => {
    put("src/test/count.test.ts", count(7, "// c"));
    put(".git/land-recount.json", JSON.stringify([{ file: "src/test/count.test.ts", name: "MARKERLESS" }]));
    const runs: string[] = [];
    const run = (file: string) => {
      const v = Number(/MARKERLESS = (\d+)/.exec(read(file))![1]);
      runs.push(String(v));
      return v === 8 ? { ok: true, out: "" } : { ok: false, out: `AssertionError: expected 8 to be ${v}` };
    };
    const r = recount({ cwd: repo, log: quiet, run });
    expect(r).toEqual({ changed: ["src/test/count.test.ts: MARKERLESS 7 -> 8"], failed: [] });
    expect(read("src/test/count.test.ts")).toContain("const MARKERLESS = 8;");
    expect(runs).toEqual(["7", "8"]);
    expect(existsSync(join(repo, ".git", "land-recount.json"))).toBe(false);
  });
});

describe("land.sh wiring", () => {
  const land = readFileSync(join(ROOT, "scripts", "land.sh"), "utf8");
  it("the rebase loop calls the resolver for any conflict and skips a commit resolved to nothing", () => {
    expect(land).toMatch(/if node scripts\/lib\/landRebaseResolve\.mjs; then\n\s+# [^\n]*\n\s+GIT_EDITOR=true git rebase --continue/);
    expect(land).toMatch(/if git diff --cached --quiet; then\n\s+git rebase --skip/);
  });
  it("the recount runs after the rebase, before the refresh", () => {
    const at = land.indexOf("\n  node scripts/lib/landRecount.mjs\n");
    expect(at).toBeGreaterThan(land.indexOf("landRebaseResolve.mjs"));
    expect(at).toBeLessThan(land.indexOf("node scripts/check-generated-current.mjs --fix"));
  });
});
