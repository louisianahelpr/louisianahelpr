/**
 * One workflow, one nightly-red issue.
 *
 * 2026-09-27: main-red-watch filed every push red as `nightly-red: main: <name>`
 * while eight of the workflows it watches also sync their own
 * `nightly-red: <slug>`. Staleness watch had both open at once, so the ops
 * ledger carried two items for one red and a fix closed only one of them.
 * main-red-watch now asks scripts/ci/nightly-slug.mjs which issue a red
 * belongs under. This fails if it goes back to a title of its own, or if the
 * resolver stops finding a workflow's own slug.
 *
 * @mutate .github/workflows/main-red-watch.yml | workflow-name: ${{ steps.slug.outputs.slug }} | workflow-name: "main: ${{ github.event.workflow_run.name }}"
 * @mutate .github/workflows/main-red-watch.yml | --title "nightly-red: ${SLUG}" | --title "nightly-red: main: ${NAME}"
 * @mutate scripts/ci/nightly-slug.mjs | if (slugs.size === 1) return | if (false) return
 * @mutate scripts/ci/nightly-slug.mjs | if (!/event_name\s*==\s*'schedule'/.test(cond)) onPush = true; | onPush = false;
 */
import { readFileSync, readdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script, no types
import { nightlySlug } from "../../scripts/ci/nightly-slug.mjs";

type Slug = { slug: string; selfFiles: boolean; selfFilesOnPush: boolean };
const DIR = join(__dirname, "..", "..", ".github", "workflows");
const WATCH_SRC = readFileSync(join(DIR, "main-red-watch.yml"), "utf8");
const watch = parse(WATCH_SRC) as { on: { workflow_run: { workflows: string[] } } };
const WATCHED = watch.on.workflow_run.workflows;

/** Every literal slug each workflow file syncs under, by display name. */
const ownSlugs = new Map<string, Set<string>>();
for (const f of readdirSync(DIR).filter((x) => /\.ya?ml$/.test(x))) {
  const src = readFileSync(join(DIR, f), "utf8");
  const name = /^name:\s*["']?(.+?)["']?\s*$/m.exec(src)?.[1];
  if (!name) continue;
  const re = /uses:\s*\.\/\.github\/actions\/nightly-issue-sync[\s\S]*?workflow-name:\s*["']?([^"'\n]+?)["']?\s*$/gm;
  for (let m; (m = re.exec(src)); ) if (!m[1].includes("${{")) (ownSlugs.get(name) ?? ownSlugs.set(name, new Set()).get(name)!).add(m[1]);
}

describe("one nightly-red issue per workflow", () => {
  it("main-red-watch files, checks and records under the resolved slug only", () => {
    expect(WATCH_SRC).toContain("node scripts/ci/nightly-slug.mjs");
    expect(WATCH_SRC).toMatch(/workflow-name:\s*\$\{\{\s*steps\.slug\.outputs\.slug\s*\}\}/);
    expect(WATCH_SRC).toContain('TITLE: "nightly-red: ${{ steps.slug.outputs.slug }}"');
    expect(WATCH_SRC).toContain('--title "nightly-red: ${SLUG}"');
    expect(WATCH_SRC, "a hard-coded `main: <name>` title reopens the duplicate").not.toMatch(/nightly-red: main: \$\{/);
    expect(WATCH_SRC).not.toMatch(/workflow-name:\s*"main: \$\{\{/);
  });

  it.each(WATCHED)("%s resolves to its own slug when it syncs one", (name) => {
    const r = nightlySlug(name) as Slug;
    const own = ownSlugs.get(name);
    if (own && own.size === 1) {
      expect(r.slug).toBe([...own][0]);
      expect(r.selfFiles).toBe(true);
    } else {
      expect(r.slug).toBe(`main: ${name}`);
      expect(r.selfFiles).toBe(false);
    }
  });

  it("a schedule-only sync is told apart from one that also runs on push", () => {
    const dir = mkdtempSync(join(tmpdir(), "slug-"));
    const wf = (name: string, cond: string) =>
      `name: ${name}\non: [push]\njobs:\n  r:\n    runs-on: x\n    steps:\n      - uses: ./.github/actions/nightly-issue-sync\n        if: ${cond}\n        with:\n          workflow-name: ${name.toLowerCase()}\n`;
    writeFileSync(join(dir, "a.yml"), wf("Sched", "always() && (github.event_name == 'schedule' || github.event_name == 'workflow_dispatch')"));
    writeFileSync(join(dir, "b.yml"), wf("Both", "always() && github.event_name != 'pull_request'"));
    expect(nightlySlug("Sched", dir)).toEqual({ slug: "sched", selfFiles: true, selfFilesOnPush: false });
    expect(nightlySlug("Both", dir)).toEqual({ slug: "both", selfFiles: true, selfFilesOnPush: true });
    expect(nightlySlug("Absent", dir)).toEqual({ slug: "main: Absent", selfFiles: false, selfFilesOnPush: false });
  });
});
