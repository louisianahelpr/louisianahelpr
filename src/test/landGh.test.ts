// @mutate scripts/lib/landGh.mjs | realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) main( | fileURLToPath(import.meta.url) === process.argv[1]) main(
// @mutate scripts/lib/landGh.mjs |   if (status.mergeable_state === "dirty") return |if (status.mergeable_state === "dirty" \|\| status.mergeable_state === "behind") return
// @mutate scripts/lib/landGh.mjs |     if (unanswered >= UNANSWERED_LIMIT_MIN) return | if (false) return
// @mutate scripts/lib/landGh.mjs |   if (status.mergeable_state === "dirty") return { verdict: "rebase" | if (false) return { verdict: "rebase"
// @mutate scripts/lib/landGh.mjs |   if (status.failed.length) return | if (false) return
// @mutate scripts/lib/landGh.mjs |   const RED = new Set(["failure", | const RED = new Set([
// @mutate scripts/land.sh |     if [ "$UNANSWERED" -gt 0 ] && [ "$VERDICT" != unanswered ]; then UNANSWERED=0; fi |     true
/*
 * GUARD: land.sh's wait never hangs and never misses a conflict (owner,
 * 2026-10-12: "fix the bottleneck before").
 *
 * Cloud sessions get HTTP 403 on every GraphQL call, and `gh pr view` is
 * GraphQL: land.sh read that as "GitHub did not answer; asking again in a
 * minute" and `continue`d past its own 180-minute limit, so PR #2672 sat 42 h
 * (a wait loop printed the line for 19 h) while the PR was DIRTY. Now every
 * GitHub call land.sh makes after the push goes through scripts/lib/landGh.mjs
 * over REST, and decidePoll stops the wait red after UNANSWERED_LIMIT_MIN
 * silent minutes or WAIT_LIMIT_MIN in all, and rebases on DIRTY at once
 * (BEHIND stays the land queue's).
 */
import { describe, it, expect } from "vitest";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  decidePoll,
  failedRequired,
  repoSlug,
  WAIT_LIMIT_MIN,
  UNANSWERED_LIMIT_MIN,
  // @ts-expect-error — plain .mjs module
} from "../../scripts/lib/landGh.mjs";

const ok = (over: Record<string, unknown> = {}) => ({ state: "open", merged: false, mergeable_state: "blocked", failed: [] as string[], ...over });

describe("decidePoll: one minute of land.sh's wait", () => {
  it("has sane limits", () => {
    expect(UNANSWERED_LIMIT_MIN).toBeGreaterThan(2);
    expect(UNANSWERED_LIMIT_MIN).toBeLessThanOrEqual(15);
    expect(WAIT_LIMIT_MIN).toBe(180);
  });

  it("a GitHub that never answers stops the wait red (the 19-hour loop of #2672)", () => {
    expect(decidePoll({ status: null, waited: 1, unanswered: 1 }).verdict).toBe("unanswered");
    expect(decidePoll({ status: null, waited: 9, unanswered: UNANSWERED_LIMIT_MIN - 1 }).verdict).toBe("unanswered");
    expect(decidePoll({ status: null, waited: 10, unanswered: UNANSWERED_LIMIT_MIN })).toMatchObject({ verdict: "timeout" });
    // the total limit holds even while GitHub is silent (the old `continue` skipped it)
    expect(decidePoll({ status: null, waited: WAIT_LIMIT_MIN, unanswered: 1 })).toMatchObject({ verdict: "timeout" });
  });

  it("merged, closed and a red required check end the wait", () => {
    expect(decidePoll({ status: ok({ merged: true, state: "closed" }), waited: 3, unanswered: 0 }).verdict).toBe("merged");
    expect(decidePoll({ status: ok({ state: "closed" }), waited: 3, unanswered: 0 }).verdict).toBe("closed");
    expect(decidePoll({ status: ok({ failed: ["CodeQL"] }), waited: 3, unanswered: 0 })).toEqual({ verdict: "failed", checks: ["CodeQL"] });
  });

  it("DIRTY rebases at once; BEHIND is the queue's and waits", () => {
    expect(decidePoll({ status: ok({ mergeable_state: "dirty" }), waited: 1, unanswered: 0 }).verdict).toBe("rebase");
    for (const m of ["behind", "blocked", "clean", "unstable", "unknown", null]) {
      expect(decidePoll({ status: ok({ mergeable_state: m }), waited: 2, unanswered: 0 }).verdict).toBe("wait");
      expect(decidePoll({ status: ok({ mergeable_state: m }), waited: WAIT_LIMIT_MIN, unanswered: 0 }).verdict).toBe("timeout");
    }
  });
});

describe("failedRequired reads the latest run of each required check", () => {
  const req = ["Vitest unit tests", "CodeQL"];
  it("red only for a required check whose newest run concluded red", () => {
    expect(failedRequired([{ id: 1, name: "CodeQL", conclusion: "failure" }, { id: 2, name: "CodeQL", conclusion: "success" }], req)).toEqual([]);
    expect(failedRequired([{ id: 2, name: "CodeQL", conclusion: "failure" }, { id: 1, name: "CodeQL", conclusion: "success" }], req)).toEqual(["CodeQL"]);
    expect(failedRequired([{ id: 3, name: "Lighthouse", conclusion: "failure" }], req)).toEqual([]);
    expect(failedRequired([{ id: 4, name: "Vitest unit tests", conclusion: null }], req)).toEqual([]);
    for (const c of ["failure", "cancelled", "timed_out"]) expect(failedRequired([{ id: 5, name: "Vitest unit tests", conclusion: c }], req)).toEqual(["Vitest unit tests"]);
  });
});

describe("repoSlug", () => {
  it("reads github.com and proxy origins", () => {
    expect(repoSlug("https://github.com/louisianahelpr/louisianahelpr")).toBe("louisianahelpr/louisianahelpr");
    expect(repoSlug("git@github.com:louisianahelpr/louisianahelpr.git")).toBe("louisianahelpr/louisianahelpr");
    expect(repoSlug("http://127.0.0.1:4312/git/louisianahelpr/louisianahelpr\n")).toBe("louisianahelpr/louisianahelpr");
  });
});

describe("land.sh uses it after the push (no GraphQL-only wait)", () => {
  const land = readFileSync(join(__dirname, "..", "..", "scripts", "land.sh"), "utf8");
  const code = land.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  it("polls through landGh.mjs, resets the silent-minute count on an answer, and acts on every verdict", () => {
    expect(code).not.toMatch(/gh pr view "\$BR"/);
    expect(code).not.toMatch(/gh pr checks/);
    expect(code).toMatch(/node "\$LAND_FROZEN_DIR\/landGh\.mjs" poll "\$PR_NUM" "\$waited" "\$UNANSWERED"/);
    expect(code).toContain('if [ "$UNANSWERED" -gt 0 ] && [ "$VERDICT" != unanswered ]; then UNANSWERED=0; fi');
    const VERDICTS = ["merged", "closed", "failed", "rebase", "timeout", "unanswered", "wait"];
    expect(VERDICTS.length).toBeGreaterThan(6);
    for (const v of VERDICTS) expect(code, v).toMatch(new RegExp(`\\n\\s*${v}\\)`));
    // landGh.mjs is frozen with the other tools, so a rebase cannot swap it mid-run
    expect(code).toMatch(/for t in [^\n]*landGh\.mjs/);
  });
});

/*
 * 2026-10-12 (train/2026-10-12-big): land.sh runs a FROZEN copy of landGh.mjs
 * from $TMPDIR, which on macOS sits under /var, a symlink to /private/var. The
 * old main-module check compared import.meta.url (the real path) with
 * process.argv[1] (the symlinked path), never matched, so every landGh call
 * printed nothing and exited 0: land.sh logged "PR #" and waited on a PR it
 * never opened. Run through a symlinked directory, landGh must still run main().
 */
describe("landGh runs its command when started through a symlinked path (frozen copy in $TMPDIR)", () => {
  it("an unknown command is refused (main ran), not silently ignored", () => {
    const real = mkdtempSync(join(tmpdir(), "landgh-real-"));
    const link = `${real}-link`;
    try {
      copyFileSync(join(__dirname, "..", "..", "scripts", "lib", "landGh.mjs"), join(real, "landGh.mjs"));
      symlinkSync(real, link);
      const r = spawnSync("node", [join(link, "landGh.mjs"), "no-such-command"], { encoding: "utf8" });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("landGh: unknown command no-such-command");
    } finally {
      rmSync(link, { force: true });
      rmSync(real, { recursive: true, force: true });
    }
  });
});
