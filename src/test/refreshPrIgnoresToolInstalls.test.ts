// @mutate .gitignore | /vendor/bundle/ | /vendor/bundle-off/
// @mutate .gitignore | /.bundle/ | /.bundle-off/
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { parse } from "yaml";

/*
 * GUARD (docs/OPEN.md Q1792): a refresh-pr job never fails on the files its
 * own tool install wrote into the checkout.
 *
 * 2026-10-13, ios-metadata.yml run 38448252004: the "Land synced Xcode
 * metadata" job installed fastlane with ruby/setup-ruby `bundler-cache: true`,
 * which writes ./vendor/bundle (7037 files) and ./.bundle/config into the
 * repo. refresh-pr's stray-file check (`git status --porcelain
 * --untracked-files=all` outside `paths`) saw them and failed the job, so the
 * synced Xcode settings never reached main. Root cause: .gitignore did not
 * ignore either directory.
 *
 * Inventory: every job in .github/workflows that uses
 * ./.github/actions/refresh-pr; for each tool-install step before it, the
 * in-tree paths that install writes must be git-ignored (checked with
 * `git check-ignore`, the same ignore rules `git status` applies).
 */
const root = join(__dirname, "..", "..");
const wfDir = join(root, ".github/workflows");

type Step = { uses?: string; with?: Record<string, unknown> };
type Job = { steps?: Step[] };

/** In-tree files a tool-install step writes (a sample file under each dir). */
function installWrites(step: Step): string[] {
  const uses = step.uses ?? "";
  if (uses.startsWith("ruby/setup-ruby@") && step.with?.["bundler-cache"] === true) {
    return ["vendor/bundle/ruby/3.3.0/bin/fastlane", ".bundle/config"];
  }
  return [];
}

const jobs: { wf: string; job: string; writes: string[] }[] = [];
for (const f of readdirSync(wfDir).filter((x) => /\.ya?ml$/.test(x)).sort()) {
  const wf = parse(readFileSync(join(wfDir, f), "utf8")) as { jobs?: Record<string, Job> };
  for (const [name, job] of Object.entries(wf.jobs ?? {})) {
    const steps = job.steps ?? [];
    const at = steps.findIndex((s) => s.uses === "./.github/actions/refresh-pr");
    if (at < 0) continue;
    jobs.push({ wf: f, job: name, writes: steps.slice(0, at).flatMap(installWrites) });
  }
}

function ignored(path: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "-q", "--no-index", path], { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false; // exit 1 = not ignored
  }
}

describe("refresh-pr jobs never trip on their own tool installs (Q1792)", () => {
  it("inventory: refresh-pr jobs exist, and at least one installs gems into the checkout", () => {
    expect(jobs.length).toBeGreaterThan(3);
    expect(jobs.filter((j) => j.writes.length > 0).length).toBeGreaterThan(0); // ios-metadata land, 2026-10-14
  });

  it("every in-tree path a refresh-pr job's tool install writes is git-ignored", () => {
    const notIgnored = jobs.flatMap((j) => j.writes.filter((p) => !ignored(p)).map((p) => `${j.wf} ${j.job}: ${p}`));
    expect(notIgnored).toEqual([]);
  });
});
