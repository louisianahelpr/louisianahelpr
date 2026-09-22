/**
 * A GAP skip must not name a REMEDY THAT CANNOT WORK.
 *
 * `e2e/prod-audit/interruptions.spec.ts` skipped its whole seven-test `apply`
 * group on "GAP: no open escrowed job by poster-e2e that helper-e2e has not
 * applied to (run scripts/audit/prod-seed.mjs --apply)". Measured 2026-09-21:
 * `7 skipped, 5 passed`. Running the named remedy would not have helped —
 * `prod-seed.mjs`'s `jobBase` writes `payment_status: "unpaid"`, and its own
 * HONEST_GAPS table says of escrow "Only the real Stripe TEST checkout +
 * webhook + release-payout produce these … never inserted." Verified live the
 * same day: `apply_to_job` refuses an unfunded job (`job_payment_is_funded`,
 * added 2026-09-06) and `open_jobs_browse` filters
 * `payment_status IN ('escrow','payout_pending','released')`, so the fixture
 * requirement is right and the remedy was the lie.
 *
 * A wrong remedy is worse than none: it makes a permanent environment gap look
 * like a one-command fix, so nobody ever runs the command and nobody ever
 * escalates. This guard reads both sides from source — every GAP skip in the
 * e2e tree, and prod-seed.mjs's own modes and disowned states — and fails when
 * a skip promises the seeder can create something the seeder says it cannot.
 *
 * @mutate e2e/prod-audit/interruptions.spec.ts | prod-seed.mjs cannot make one | run scripts/audit/prod-seed.mjs --apply to make one
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(repoRoot, rel), "utf8");

const seedRel = "scripts/audit/prod-seed.mjs";
const seedSrc = read(seedRel);

/** The seeder's real modes, from the line that defines them. */
const SEED_MODES = [...(/const MODE = \[([^\]]+)\]/.exec(seedSrc)?.[1] ?? "").matchAll(/"(--[a-z-]+)"/g)].map((m) => m[1]);

/**
 * The `payment_status` every job `--apply` creates carries.
 *
 * `payment_status[:]` rather than `payment_status:` on purpose — do not
 * "tidy" it. `src/test/fixturePaymentStatus.test.ts` scans every file under
 * src/test and e2e for /payment_status:\s*"([^"]+)"/ and checks the value
 * against the live CHECK constraint, so the plain spelling made this file's own
 * capture group read as a fixture declaring an impossible status — and that
 * guard went red on it. Keep the bracket, in code AND in prose.
 */
const APPLY_PAYMENT_STATUS = /const jobBase = \{[^}]*?payment_status[:]\s*"([a-z_]+)"/.exec(seedSrc)?.[1];

/**
 * States the seeder DISOWNS, read out of its own HONEST_GAPS table rather than
 * listed here. Each subject line is a `/`-separated list of states followed by
 * a noun, so the state words are the inventory.
 */
const honestGapsBlock = /const HONEST_GAPS = \[([\s\S]*?)\n\];/.exec(seedSrc)?.[1] ?? "";
const DISOWNED_STATES = [
  ...new Set(
    [...honestGapsBlock.matchAll(/^\s*\["([^"]+)",/gm)]
      .flatMap((m) => m[1].split(/[/,]/))
      .map((s) => s.trim().split(/\s+/)[0].toLowerCase())
      .filter((s) => /^[a-z_]{4,}$/.test(s)),
  ),
];

/** Every GAP skip reason in the e2e tree, with the file and line it sits on. */
type Gap = { file: string; line: number; text: string };
const specFiles = execFileSync("git", ["ls-files", "--", "e2e/*.spec.ts", "e2e/**/*.spec.ts"], {
  cwd: repoRoot,
  encoding: "utf8",
})
  .split("\n")
  .map((f) => f.trim())
  .filter(Boolean);

/*
 * A skip message longer than a line is built by concatenation, so a line-based
 * reader sees only its first fragment — and the remedy usually sits in a later
 * one. Caught by this guard's own mutation run: the first version scanned lines
 * and the registered mutation SURVIVED, because reinstating the bad remedy put
 * it on line two of a three-line message. Continuation lines are folded in.
 */
const gapsIn = (file: string): Gap[] => {
  const lines = read(file).split("\n");
  const out: Gap[] = [];
  lines.forEach((line, i) => {
    const m = /["'`](GAP: [^"'`]*)/.exec(line);
    if (!m) return;
    let text = m[1];
    for (let j = i; /\+\s*$/.test(lines[j]) && j + 1 < lines.length; ) {
      j++;
      const cont = /["'`]([^"'`]*)["'`]/.exec(lines[j]);
      if (cont) text += cont[1];
    }
    out.push({ file, line: i + 1, text });
  });
  return out;
};

const gaps: Gap[] = specFiles.flatMap(gapsIn);

describe("prod-audit GAP skips name a remedy that can actually produce the state", () => {
  it("has a GAP inventory and a seeder inventory to check against", () => {
    // Floors: three independent reads, none of them this file's own literals.
    expect(gaps.length).toBeGreaterThanOrEqual(8);
    expect(SEED_MODES).toContain("--apply");
    expect(APPLY_PAYMENT_STATUS).toBeTruthy();
    expect(DISOWNED_STATES).toContain("escrow");
  });

  it("never names a prod-seed flag that is not one of its modes", () => {
    const offenders = gaps
      .flatMap((g) => [...g.text.matchAll(/prod-seed\.mjs\s+(--[a-z-]+)/g)].map((m) => ({ ...g, flag: m[1] })))
      .filter((g) => !SEED_MODES.includes(g.flag))
      .map((g) => `${g.file}:${g.line} names ${g.flag}, which is not a prod-seed mode (${SEED_MODES.join(" ")})`);
    expect(offenders).toEqual([]);
  });

  it("never offers `prod-seed.mjs --apply` for a state prod-seed's own HONEST_GAPS disowns", () => {
    const offenders = gaps
      .filter((g) => /prod-seed\.mjs\s+--apply/.test(g.text))
      .flatMap((g) => {
        // Word START, not whole word: the skip that started this said
        // "escrowed", and `\bescrow\b` would have let it through.
        const asked = DISOWNED_STATES.filter((s) => new RegExp(`\\b${s}`, "i").test(g.text));
        return asked.length
          ? [
              `${g.file}:${g.line} offers --apply for ${asked.join("/")}, but prod-seed's HONEST_GAPS says it never inserts those ` +
                `(every job it creates is payment_status "${APPLY_PAYMENT_STATUS}")`,
            ]
          : [];
      });
    expect(offenders).toEqual([]);
  });
});
