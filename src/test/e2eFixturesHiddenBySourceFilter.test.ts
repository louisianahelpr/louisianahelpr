import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { jobIsUnfundedDraft } from "@/pages/activity/activityFilters";
import { UNPAID_DRAFT_PAYMENT_STATES } from "@/hooks/useUnpaidJobDrafts";

/**
 * THE CLASS: a product rule starts hiding rows AT THE SOURCE, and a prod e2e
 * fixture goes on building rows in exactly that hidden state and asserting
 * them on exactly that surface. The spec then fails days later against a
 * screen that is behaving correctly, and the failure reads as a app bug.
 *
 * What it cost (issue #1595, 2026-09-22). `8fdee80ca` filed unpaid jobs as
 * DRAFTS — `jobIsUnfundedDraft` drops payment_status unpaid/abandoned/failed
 * on an OPEN job out of `postedJobs`, so they leave the My Posts list and its
 * tab counts together. Right: no Helpr could see them on any browse feed, so
 * My Posts was showing a healthy "Waiting" card for a job that could never
 * move. But `e2e/journeys/time-travel.spec.ts` creates its fixture by POSTing
 * to `/rest/v1/jobs` as the poster, and the live `enforce_jobs_insert_column
 * _lock` forces EVERY such row to `status := 'open'`, `payment_status :=
 * 'unpaid'` — the precise shape the new rule hides. Ten countdown-chip
 * assertions on `/my-posts` went red the same night, and e2e-journeys stayed
 * red with them.
 *
 * THE GUARD, and why it is not a list checked against itself. The inventory of
 * job-creating specs comes from the filesystem; the "is this shape hidden?"
 * answer comes from the app's own `jobIsUnfundedDraft`; the insert shape comes
 * from the migration that defines the lock. Three independent sources, then a
 * diff. Nothing here is both the input and the oracle.
 *
 * SHOWN ABLE TO FAIL: the last case runs the same predicate over the file as
 * it stood before the fix (checked in below as the shape it had), and requires
 * it to be reported.
 */
// Break the product rule this guard reads and the second case fails: a job the
// insert lock forces to open+unpaid is no longer recognised as hidden, which is
// the exact reading that decides whether an e2e fixture is safe on My Posts.
// @mutate src/pages/activity/activityFilters.ts | return moneyNeverLanded && j.status === "open"; | return false;

const REPO = join(__dirname, "..", "..");

/** Every e2e spec file, from the filesystem — never a hand-kept list. */
function specFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) specFiles(p, out);
    else if (name.endsWith(".spec.ts")) out.push(p);
  }
  return out;
}

/** Creates a job the way a real poster does: a REST INSERT on its own token. */
const CREATES_JOB_VIA_REST = /\.post\(\s*`\$\{SUPABASE_URL\}\/rest\/v1\/jobs/;
/** Navigates to one of the two surfaces that list a poster's / helper's jobs. */
const VISITS_A_JOB_LIST = /["'`]\/my-(posts|jobs)/;
/** Funds through the real Checkout, so its row leaves the unfunded state. */
const FUNDS_THROUGH_CHECKOUT = /functions\/v1\/create-payment/;
/**
 * States the expectation out loud. Either an explicit absence assertion, or
 * the token for a spec that has some other reason to be sure.
 */
const ACKNOWLEDGES_THE_RULE = /toHaveCount\(0\)|UNFUNDED-DRAFT-OK/;

/**
 * Files that build a job through the poster INSERT path, then drive a surface
 * that the app's own filter keeps that job off — without saying so.
 */
export function unacknowledgedFixtures(files: Array<{ path: string; source: string }>): string[] {
  return files
    .filter(
      (f) =>
        CREATES_JOB_VIA_REST.test(f.source) &&
        VISITS_A_JOB_LIST.test(f.source) &&
        !FUNDS_THROUGH_CHECKOUT.test(f.source) &&
        !ACKNOWLEDGES_THE_RULE.test(f.source),
    )
    .map((f) => f.path);
}

describe("e2e job fixtures vs the filters that hide them", () => {
  it("the poster INSERT lock still forces open + unpaid, which is the shape the fixtures land in", () => {
    const migrations = join(REPO, "supabase", "migrations");
    const defining = readdirSync(migrations)
      .filter((n) => n.endsWith(".sql"))
      .sort()
      .map((n) => ({ n, sql: readFileSync(join(migrations, n), "utf8") }))
      .filter(({ sql }) => sql.includes("FUNCTION public.enforce_jobs_insert_column_lock"));
    expect(defining.length, "no migration defines enforce_jobs_insert_column_lock").toBeGreaterThan(0);
    const latest = defining[defining.length - 1].sql;
    // Verified live on prod 2026-09-22 (pg_get_functiondef): a poster
    // self-insert is rewritten to these two values whatever the client sent.
    expect(latest, "the lock no longer forces payment_status to unpaid").toMatch(/NEW\.payment_status\s*:=\s*'unpaid'/);
    expect(latest, "the lock no longer forces status to open").toMatch(/NEW\.status\s*:=\s*'open'/);
  });

  it("the app's own rule says that shape is a draft — so it is NOT on My Posts", () => {
    // Read with the app's predicate, not a copy of it.
    expect(jobIsUnfundedDraft({ status: "open", payment_status: "unpaid" })).toBe(true);
    // The three payment states are one fact in two files; a job that slips
    // between them is invisible on every surface at once.
    for (const state of UNPAID_DRAFT_PAYMENT_STATES) {
      expect(jobIsUnfundedDraft({ status: "open", payment_status: state }), `${state} is not read as unfunded`).toBe(true);
    }
  });

  it("no e2e spec creates such a job and then drives a job list without saying what it expects", () => {
    const files = specFiles(join(REPO, "e2e")).map((path) => ({
      path: path.slice(REPO.length + 1),
      source: readFileSync(path, "utf8"),
    }));
    expect(files.length, "no e2e specs were found — the scan is broken, not the tree").toBeGreaterThan(10);
    expect(
      unacknowledgedFixtures(files),
      "these specs POST a job to /rest/v1/jobs (forced to open+unpaid by the insert lock), then drive " +
        "/my-posts or /my-jobs, where jobIsUnfundedDraft keeps that row off the list AND out of the tab " +
        "counts. Either fund it through create-payment, or assert the absence (toHaveCount(0)).",
    ).toEqual([]);
  });

  it("is shown able to fail: the spec as it stood when #1595's countdown leg went red", () => {
    // e2e/journeys/time-travel.spec.ts before 2026-09-22 — it posted the job
    // and then asserted a chip on /my-posts, with nothing funded and no
    // absence assertion anywhere in the file.
    const before = `
      const r = await request.post(\`\${SUPABASE_URL}/rest/v1/jobs?select=id,title,expires_at\`, {
        data: { status: "open", payment_status: "unpaid" },
      });
      await page.goto(\`/my-posts?job=\${job.id}\`);
      await expect(card).toBeVisible({ timeout: 20_000 });
    `;
    expect(unacknowledgedFixtures([{ path: "e2e/journeys/time-travel.spec.ts", source: before }])).toEqual([
      "e2e/journeys/time-travel.spec.ts",
    ]);
  });
});
