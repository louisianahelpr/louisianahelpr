/**
 * Q807 made the database refuse every write from an authenticated session
 * whose auth.users row has no email_confirmed_at (trigger
 * zz_refuse_unconfirmed_email_write, migration 20260927234313). The CI
 * harnesses that replay every migration into a real supabase/postgres image
 * and then act as `authenticated` seed their users with a bare
 * `INSERT INTO auth.users (id, email)`, so after Q807 every one of their
 * authenticated writes failed with `email_unconfirmed` — race-runner run
 * 36361242882 went red on "CONTROL FAILED ... email_unconfirmed" for races
 * 1/2/3/4/6, and null-arg-validators would have reported the same refusal as
 * a validator result, masking a missing one.
 *
 * Class check: every `INSERT INTO auth.users (...)` in a migration-replay
 * harness (scripts/ci/*, .github/workflows/*.yml) names email_confirmed_at in
 * its column list. A fixture user that is deliberately UNconfirmed must say
 * so by naming the column and inserting NULL.
 *
 * @mutate scripts/ci/race-runner.mjs | (id, email, email_confirmed_at) VALUES ($1, $2, now())", [id, `race-${who}-${id}@helpr.test`]);\n    // Approved | (id, email) VALUES ($1, $2)", [id, `race-${who}-${id}@helpr.test`]);\n    // Approved
 * @mutate scripts/ci/null-arg-validators.sql | INSERT INTO auth.users (id, email, email_confirmed_at) VALUES | INSERT INTO auth.users (id, email) VALUES
 * @mutate .github/workflows/db-smoke.yml | INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (admin_id | INSERT INTO auth.users (id, email) VALUES (admin_id
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");

function harnessFiles(): { rel: string; src: string }[] {
  const out: { rel: string; src: string }[] = [];
  for (const f of readdirSync(join(ROOT, "scripts/ci")).sort()) {
    const rel = `scripts/ci/${f}`;
    const raw = readFileSync(join(ROOT, rel), "utf8");
    if (/\.(mjs|js|ts)$/.test(f)) out.push({ rel, src: blankComments(raw) });
    else if (/\.sql$/.test(f)) out.push({ rel, src: blankSqlComments(raw) });
    else if (/\.sh$/.test(f)) out.push({ rel, src: raw });
  }
  for (const f of readdirSync(join(ROOT, ".github/workflows")).sort()) {
    if (!/\.ya?ml$/.test(f)) continue;
    const rel = `.github/workflows/${f}`;
    // YAML is scanned raw: a commented-out bare insert can only make this stricter.
    out.push({ rel, src: readFileSync(join(ROOT, rel), "utf8") });
  }
  return out;
}

const sites = harnessFiles().flatMap(({ rel, src }) =>
  [...src.matchAll(/INSERT\s+INTO\s+auth\.users\s*\(([^)]*)\)/gi)].map((m) => ({
    where: `${rel}:${src.slice(0, m.index).split("\n").length}`,
    cols: m[1].split(",").map((c) => c.trim().toLowerCase()),
  })),
);

describe("CI fixture users are email-confirmed (Q807 gate)", () => {
  it("finds the fixture inserts it exists to check (inventory floor)", () => {
    // 2026-09-28: race-runner.mjs x2, null-arg-validators.sql x1, db-smoke.yml x4.
    expect(sites.length).toBeGreaterThanOrEqual(7);
  });

  it("every INSERT INTO auth.users names email_confirmed_at", () => {
    const bare = sites.filter((s) => !s.cols.includes("email_confirmed_at")).map((s) => s.where);
    expect(bare, "fixture users without email_confirmed_at are refused by zz_refuse_unconfirmed_email_write").toEqual([]);
  });
});
