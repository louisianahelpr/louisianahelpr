import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "yaml";

/**
 * functions-deploy's "Determine functions to deploy" step, RUN for every event
 * shape it can see (ops ledger 1bbb3f41bbe7, 2026-10-12).
 *
 * Run 38285548214 (workflow_dispatch, no function name) died in this step with
 * exit 128. With no before-SHA and no function name the step correctly decided
 * "deploy ALL", then ran `git diff --name-only "" HEAD` anyway, before it ever
 * reached the deploy-all branch. The one fallback that exists so prod can never
 * be left stale could not run: every no-input dispatch failed, and so would any
 * push with an all-zeros or unreachable before-SHA (new branch, force-push).
 *
 * The class is "an event shape the step cannot handle", so this test does not
 * read the script's text: it executes the step's own `run:` body in a scratch
 * git repo with the env and `${{ }}` values GitHub would give it, once per shape,
 * and checks what it writes to GITHUB_OUTPUT.
 *
 * @mutate .github/workflows/functions-deploy.yml | elif [ "${FORCE_DEPLOY_ALL:-0}" = "1" ]; then\n            # No diff base | elif false; then\n            # No diff base
 * @mutate .github/workflows/functions-deploy.yml |             FORCE_DEPLOY_ALL=1 |             FORCE_DEPLOY_ALL=0
 */

const REPO = resolve(__dirname, "../..");
const WORKFLOW = parse(readFileSync(resolve(REPO, ".github/workflows/functions-deploy.yml"), "utf8"));

type Step = { name?: string; run?: string; env?: Record<string, string> };
const STEP: Step = (WORKFLOW.jobs.deploy.steps as Step[]).find((s) => s.name === "Determine functions to deploy")!;

const ZEROS = "0000000000000000000000000000000000000000";
const REAL_FUNCTIONS = readdirSync(resolve(REPO, "supabase/functions"), { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== "_shared")
  .map((d) => d.name);

type Event = { before?: string; functionName?: string };

/** What GitHub substitutes for the step's `${{ }}` expressions on this event. */
function expr(src: string, ev: Event): string {
  return src.replace(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_m, e: string) => {
    if (e === "github.event.before") return ev.before ?? "";
    if (e === "github.event.inputs.function_name") return ev.functionName ?? "";
    throw new Error(`unhandled expression in the step: ${e}`);
  });
}

let dir = "";
let base = "";
const git = (...args: string[]) => {
  const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const put = (rel: string, body: string) => {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), body);
};

function runStep(ev: Event) {
  const out = join(dir, "gh-output");
  writeFileSync(out, "");
  const env: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: dir, GITHUB_OUTPUT: out };
  for (const [k, v] of Object.entries(STEP.env ?? {})) env[k] = expr(String(v), ev);
  const r = spawnSync("bash", ["-e", "-c", expr(STEP.run!, ev)], { cwd: dir, encoding: "utf8", env });
  const output = readFileSync(out, "utf8");
  const fns = (/^functions=(.*)$/m.exec(output)?.[1] ?? "").trim().split(/\s+/).filter(Boolean).sort();
  return { code: r.status, log: r.stdout + r.stderr, output, fns };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "fn-deploy-targets-"));
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  put("supabase/functions/alpha/index.ts", "export {};\n");
  put("supabase/functions/beta/index.ts", "export {};\n");
  put("supabase/functions/_shared/lib.ts", "export {};\n");
  put("supabase/config.toml", "[functions.alpha]\n");
  put(".github/workflows/functions-deploy.yml", "name: x\n");
  put("README.md", "x\n");
  git("add", "-A");
  git("commit", "-qm", "base");
  base = git("rev-parse", "HEAD");
});
afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("functions-deploy picks its targets on every event shape", () => {
  it("reads the real step, and the repo really has functions to deploy", () => {
    expect(STEP?.run).toBeTruthy();
    expect(REAL_FUNCTIONS.length).toBeGreaterThan(50);
  });

  it("workflow_dispatch with no function name deploys ALL (run 38285548214 died here)", () => {
    const r = runStep({});
    expect(r.code, r.log).toBe(0);
    expect(r.output).toContain("skip_deploy=false");
    expect(r.fns).toEqual(["alpha", "beta"]);
  });

  it("a push with no usable before-SHA deploys ALL, never nothing and never a crash", () => {
    for (const before of [ZEROS, "0123456789abcdef0123456789abcdef01234567"]) {
      const r = runStep({ before });
      expect(r.code, `${before}\n${r.log}`).toBe(0);
      expect(r.fns).toEqual(["alpha", "beta"]);
    }
  });

  it("workflow_dispatch with a function name deploys just that one; an unknown name fails", () => {
    const one = runStep({ functionName: "beta" });
    expect(one.code, one.log).toBe(0);
    expect(one.fns).toEqual(["beta"]);
    const bad = runStep({ functionName: "nope" });
    expect(bad.code).not.toBe(0);
  });

  it("a push deploys the changed function, all on _shared, and nothing on an unrelated change", () => {
    git("checkout", "-q", base);
    put("supabase/functions/alpha/index.ts", "export const a = 1;\n");
    git("commit", "-qam", "alpha");
    const changed = runStep({ before: base });
    expect(changed.code, changed.log).toBe(0);
    expect(changed.fns).toEqual(["alpha"]);

    git("checkout", "-q", base);
    put("supabase/functions/_shared/lib.ts", "export const s = 1;\n");
    git("commit", "-qam", "shared");
    const shared = runStep({ before: base });
    expect(shared.code, shared.log).toBe(0);
    expect(shared.fns).toEqual(["alpha", "beta"]);

    git("checkout", "-q", base);
    put("README.md", "y\n");
    git("commit", "-qam", "docs");
    const none = runStep({ before: base });
    expect(none.code, none.log).toBe(0);
    expect(none.output).toContain("skip_deploy=true");
    expect(none.fns).toEqual([]);
  });
});
