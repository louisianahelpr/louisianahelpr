// @mutate .github/workflows/broken-links.yml | uses: lycheeverse/lychee-action@e7477775783ea5526144ba13e8db5eec57747ce8 # v2.9.0 | uses: lycheeverse/lychee-action@v2 # v2.9.0
// @mutate .github/workflows/sentry-release.yml | uses: getsentry/action-release@ff07929a6537bac57790c3451cf4d364aca38528 # v3.7.0 | uses: getsentry/action-release@ff07929a6537bac57790c3451cf4d364aca38528
/*
 * GUARD (2026-10-05, owner-approved hardening): every GitHub Action this repo
 * runs is pinned to a full 40-hex commit SHA.
 *
 * A tag (`@v3`) is a movable pointer: whoever controls the action's repo can
 * repoint it, and the next run executes the new code with this repo's secrets
 * (the tj-actions/changed-files compromise, March 2025, worked exactly so).
 * Measured on origin/main 3e791549c: 332 non-local `uses:` lines, 0 pinned,
 * 7 third-party actions (supabase/setup-cli, getsentry/action-release,
 * dorny/paths-filter, treosh/lighthouse-ci-action, lycheeverse/lychee-action,
 * denoland/setup-deno, ruby/setup-ruby).
 *
 * Class check, from the files themselves: every `uses:` in
 * .github/workflows/*.yml and .github/actions/** /action.yml (steps and
 * job-level reusable workflows) is either local (`./...`) or `<ref>@<40-hex>`,
 * and the raw line keeps the version as a trailing comment (`# v1.2.3`) so
 * Dependabot (github-actions ecosystem, .github/dependabot.yml) can keep the
 * pin current. No allowlist: nothing in the repo needs one. `docker://` refs
 * must carry an `@sha256:` digest.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "yaml";

const ROOT = join(__dirname, "..", "..");
const WF = join(ROOT, ".github", "workflows");
const ACTIONS = join(ROOT, ".github", "actions");

function files(): string[] {
  const out = readdirSync(WF).filter((f) => /\.ya?ml$/.test(f)).map((f) => join(WF, f));
  if (existsSync(ACTIONS)) {
    for (const d of readdirSync(ACTIONS)) {
      const dir = join(ACTIONS, d);
      if (!statSync(dir).isDirectory()) continue;
      for (const name of ["action.yml", "action.yaml"]) if (existsSync(join(dir, name))) out.push(join(dir, name));
    }
  }
  return out.sort();
}

/** Every `uses` value anywhere in the parsed document (YAML drops comments). */
function usesValues(node: unknown, acc: string[] = []): string[] {
  if (Array.isArray(node)) for (const n of node) usesValues(n, acc);
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "uses" && typeof v === "string") acc.push(v.trim());
      else usesValues(v, acc);
    }
  }
  return acc;
}

const PINNED = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+@[0-9a-f]{40}$/;
const DOCKER_PINNED = /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/;

function scan() {
  const all: string[] = [];
  const unpinned: string[] = [];
  const noVersionComment: string[] = [];
  for (const f of files()) {
    const rel = relative(ROOT, f);
    const text = readFileSync(f, "utf8");
    for (const u of usesValues(parse(text))) {
      if (u.startsWith("./")) continue;
      all.push(u);
      if (!(PINNED.test(u) || DOCKER_PINNED.test(u))) unpinned.push(`${rel}: ${u}`);
    }
    // Raw lines: a pinned ref keeps its human version as a trailing comment.
    for (const [i, line] of text.split("\n").entries()) {
      const m = /^\s*(?:-\s*)?uses:\s*["']?([^\s"'#]+)["']?(.*)$/.exec(line);
      if (!m || m[1].startsWith("./") || m[1].startsWith("docker://")) continue;
      if (!/^\s*#\s*v?\d+(\.\d+)*\S*\s*$/.test(m[2])) noVersionComment.push(`${rel}:${i + 1}: ${line.trim()}`);
    }
  }
  return { all, unpinned, noVersionComment };
}

describe("every GitHub Action is pinned to a full commit SHA", () => {
  const { all, unpinned, noVersionComment } = scan();

  it("reads the real workflow and composite-action files (floor)", () => {
    expect(files().length).toBeGreaterThan(60);
    expect(all.length).toBeGreaterThan(300);
  });

  it("no non-local `uses:` is a tag or branch", () => {
    expect(
      unpinned,
      "pin to the commit SHA of the tag: gh api repos/<owner>/<repo>/git/ref/tags/<tag> (dereference an annotated tag via git/tags/<sha>), keep `# <tag>` after it",
    ).toEqual([]);
  });

  it("every pinned `uses:` keeps its version as a trailing `# vX.Y.Z` comment", () => {
    expect(noVersionComment).toEqual([]);
  });
});
