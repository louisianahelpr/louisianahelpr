/**
 * Shared plumbing for the vacuity gate (see scripts/vacuity/README.md).
 *
 * THE RULE THIS ENFORCES, verbatim from CLAUDE.md:
 *   "Completeness is proven, not claimed: inventory from source, minus what
 *    was checked, must be empty, AND EVERY CHECK MUST BE SHOWN ABLE TO FAIL."
 *
 * The second half had no machinery behind it. It was honoured only when a
 * human remembered to break the code by hand, which on 2026-09-19 turned out
 * to mean: almost never. Five guards that looked like guards could not fail.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

export const REPO = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..");

/**
 * The guard set, DERIVED FROM THE WORLD (git ls-files), never from a list.
 *
 * WIDENED 2026-09-20 from `src/test/*.test.ts*` (190 files) to EVERY test in the
 * repo (639). Owner: *"extend the scan to all 639 … nothing should be left
 * unturned."*
 *
 * WHY THE NARROW SCAN WAS THE REAL PROBLEM. The ratchet only listed files it
 * could see, so a hollow test in the other 449 — the 53 edge guards, the 60
 * Playwright specs, the 336 colocated component tests — was not merely unproven,
 * it was not even LISTED as unproven. `npm run vacuity` printed a green
 * "registration: N/190" while 449 files sat outside the count entirely. That is
 * the same failure shape the burn-down exists to kill: green is what a check
 * reports when it is looking at nothing.
 *
 * Eight hollow guards were found inside the 190 in one evening — including one
 * that passed 16/16 with an entire admin authorization check deleted, and one
 * that passed 6/6 with a ban pardon-release removed. There is no reason to think
 * the unwatched 449 are cleaner; they were simply never asked.
 *
 * `git ls-files` rather than a recursive readdir: an untracked scratch spec in a
 * worktree must not enter the ratchet and make someone else's push red.
 */
export function guardFiles() {
  return execFileSync("git", ["ls-files", "--", "*.test.ts", "*.test.tsx", "*.spec.ts", "*.spec.tsx"], {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 1 << 24,
  })
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean)
    .filter((f) => !isScratchProbe(f))
    .sort();
}

/**
 * A file that declares itself SCRATCH is measurement scaffolding, not a guard,
 * and must not sit in the denominator.
 *
 * `e2e/happy-path/zz-senior-probe.spec.ts` is 542 lines and 8 tests with
 * exactly ONE `expect()` in the whole file — and that one only checks it
 * visited every route. Its own header says "SCRATCH probe … Untracked
 * scaffolding for the accessibility audit lane; not a suite contract", while
 * being, in fact, tracked. Everything else it does is write measurements to
 * disk.
 *
 * Counting it made the burn-down's denominator one larger and its coverage
 * claim one weaker — the same reason `example.test.ts` was DELETED rather than
 * proved when its body turned out to be `expect(true).toBe(true)`. This one is
 * kept, because a measurement harness is worth having; it is simply not a
 * check.
 *
 * Read from the file's own words rather than a hand-kept list, so the
 * exemption evaporates the moment someone promotes it: delete the word and it
 * must be proven like anything else.
 */
export function isScratchProbe(rel) {
  try {
    /*
     * An explicit DECLARATION, not the word "scratch" appearing anywhere.
     *
     * A first cut matched /\bSCRATCH\b/ and immediately excluded
     * `src/test/selfGatedSpecsAreRunnable.test.ts` — a real guard whose only
     * crime was explaining this very exemption in a comment. That is the same
     * failure as every other one found today: a rule that PROSE can satisfy.
     * A marker has to be something you can only write on purpose.
     */
    return /^\s*(?:\/\/|\*)\s*@scratch-probe\b/m.test(fs.readFileSync(path.join(REPO, rel), "utf8"));
  } catch {
    return false;
  }
}

/**
 * Untracked-but-not-ignored test files.
 *
 * THE HOLE THIS CLOSES (found 2026-09-21, by this gate failing to notice its
 * own new guard). `guardFiles()` is `git ls-files`, deliberately: an untracked
 * scratch spec must not enter the RATCHET and make someone else's push red.
 * But the MUTATION phase collected its registrations from that same tracked
 * list, so a guard written and not yet `git add`ed contributed zero mutations —
 * and the run printed a green "mutation: nothing in scope". The single most
 * important moment for this gate (a guard being born) was the one moment it
 * was blind, and it said green while blind. That is the exact shape the whole
 * burn-down exists to kill.
 *
 * Kept separate from `guardFiles()` so the ratchet keeps its tracked-only
 * semantics; only the mutation phase unions these in.
 */
export function untrackedGuardFiles() {
  return execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 1 << 24,
  })
    .split("\n")
    .map((f) => f.trim())
    .filter((f) => /\.(test|spec)\.tsx?$/.test(f))
    .sort();
}

/** Edge guards — reported on, never edited by this lane (src/test/edge is owned elsewhere). */
export function edgeGuardFiles() {
  const dir = path.join(REPO, "src", "test", "edge");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.test\.tsx?$/.test(f))
    .map((f) => path.posix.join("src/test/edge", f))
    .sort();
}

export const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
export const exists = (rel) => fs.existsSync(path.join(REPO, rel));

/**
 * REGISTRATION FORMAT — deliberately one line, because a registration that
 * costs more than one line does not get written.
 *
 *   // @mutate <file-to-break> | <literal to find> | <what to put there>
 *   // @mutate-exempt <reason>          (loud, counted, ratcheted)
 *
 * `find` must occur EXACTLY ONCE in the target, otherwise the mutation is
 * ambiguous and the registration itself fails. `replace` may be empty, which
 * deletes the text — the commonest and bluntest mutation.
 *
 * Escapes: \n, \t, \| inside a field.
 */
const MUTATE_RE = /^\s*(?:\/\/|\*)\s*@mutate\s+(.+)$/;
const EXEMPT_RE = /^\s*(?:\/\/|\*)\s*@mutate-exempt\s+(.+)$/;

const unescape = (s) => s.replace(/\\\|/g, "|").replace(/\\n/g, "\n").replace(/\\t/g, "\t");

export function parseDirectives(rel) {
  const src = read(rel);
  const mutations = [];
  const exemptions = [];
  src.split("\n").forEach((line, i) => {
    const m = MUTATE_RE.exec(line);
    if (m) {
      const parts = m[1].split(/(?<!\\)\|/).map((p) => p.trim());
      /*
       * MORE THAN THREE FIELDS IS MALFORMED, NOT "extra fields to discard".
       *
       * This used to take parts[0..2] and throw the rest away. A directive
       * whose find or replace contains an unescaped `||` — which most real
       * guard conditions do — therefore silently became a DIFFERENT mutation:
       *
       *   ... | if (!released || released.length === 0) { | if (false) {
       *   ->  find: "if (!released"   replace: "released.length === 0) {"
       *
       * That splices unparseable code into the target. The guard then fails to
       * LOAD, and a guard that fails is scored `killed` — so the registration
       * reported a proof it had not performed. Measured 2026-09-21: 17 of 485
       * registrations were in this state, including four on money paths.
       *
       * A fake kill is worse than no registration at all: it removes the file
       * from the burn-down and tells everyone it is proven. Escaping exists
       * (`\|`); the parser must insist on it rather than guess.
       */
      mutations.push({
        guard: rel,
        line: i + 1,
        target: parts[0] ?? "",
        find: unescape(parts[1] ?? ""),
        replace: unescape(parts[2] ?? ""),
        raw: m[1].trim(),
        malformed: parts.length < 2 || parts.length > 3 || !parts[0] || !parts[1],
        tooManyFields: parts.length > 3,
      });
      return;
    }
    const e = EXEMPT_RE.exec(line);
    if (e) exemptions.push({ guard: rel, line: i + 1, reason: e[1].trim() });
  });
  return { mutations, exemptions };
}

export const BASELINE_PATH = "src/test/vacuity.baseline.json";

export function loadBaseline() {
  if (!exists(BASELINE_PATH)) return { unregistered: [] };
  return JSON.parse(read(BASELINE_PATH));
}

/** Files changed vs a merge base — used for the per-push subset. */
export function changedFiles(base = "origin/main") {
  try {
    const out = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
      cwd: REPO,
      encoding: "utf8",
    });
    const dirty = execFileSync("git", ["diff", "--name-only", "HEAD"], {
      cwd: REPO,
      encoding: "utf8",
    });
    // Untracked files too: a brand-new guard is the single most important
    // thing for this gate to notice, and `git diff` never lists one.
    const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
      cwd: REPO,
      encoding: "utf8",
    });
    return new Set([...out.split("\n"), ...dirty.split("\n"), ...untracked.split("\n")].filter(Boolean));
  } catch {
    return null; // no git / no base — caller falls back to the full set
  }
}

export function gitIsClean(rel) {
  try {
    const out = execFileSync("git", ["status", "--porcelain", "--", rel], {
      cwd: REPO,
      encoding: "utf8",
    });
    return out.trim() === "";
  } catch {
    return false;
  }
}

export const c = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};
