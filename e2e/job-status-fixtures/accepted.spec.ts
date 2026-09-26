/**
 * JOB-STATUS FIXTURES on prod: the states the prod a11y sweep renders that
 * nothing else keeps alive (nightly-red #1794).
 *
 * e2e/a11y-prod/a11y-prod.spec.ts sweeps /jobs/<id> once per job_status, from
 * poster-e2e's own is_seed jobs, and a status with no row SKIPS, which the
 * skip reporter fails as unjustified. a11y-webkit-prod run 36148473443
 * (2026-09-25) failed both engines on exactly that: "no is_seed job in status
 * "accepted" owned by the poster on prod". `accepted` is a waiting state the
 * product always moves on (auto-expire-jobs re-opens an unconfirmed hire at
 * its deadline), so a borrowed row cannot hold it; this spec owns one, the
 * way messy-input owns the disputed job. The rules are planAcceptedJob's
 * (e2e/prod-audit/fundedOpenJobPlan.ts).
 *
 * WHO RUNS IT. a11y-webkit-prod.yml's `fixtures` job, alone
 * (`--project=job-status-fixtures`), BEFORE both sweep legs: the legs run in
 * parallel and are read-only, so neither may mint it. The workflow's
 * prod-load group is its account lock (src/test/prodWorkflowSpacing.test.ts,
 * DISPATCH_SHARES_GROUP), as for the sweep itself.
 *
 * A fresh fixture is a real Stripe TEST checkout plus the 20-minute
 * early-access wait before helper-e2e can apply, about once every
 * NEW_FIXTURE_DAYS - MIN_RUNWAY_DAYS days; every other run is two reads.
 * Failure THROWS: nothing in this file skips.
 *
 * Shown able to fail: src/test/acceptedJobFixture.test.ts registers the
 * mutations of the plan and of the workflow wiring. The one below is this
 * spec's own: ensureAcceptedJob hands back a row with no runway left (what
 * auto-expire-jobs would re-open tomorrow) and the runway assertion goes red.
 * It needs no mint: on a run that reuses the fixture it is two reads.
 */
// @mutate e2e/prod-audit/fundedOpenJob.ts | return { job: { id, title: after.title, date_needed: after.date_needed }, log }; | return { job: { id, title: after.title, date_needed: centralDatePlus(0) }, log };
import { test, expect } from "../prodTest";
import { ensureAcceptedJob, centralDatePlus } from "../prod-audit/fundedOpenJob";
import { MIN_RUNWAY_DAYS, daysBetween } from "../prod-audit/fundedOpenJobPlan";
import { getSession } from "../prod-audit/harness";

test("accepted: poster-e2e has an is_seed job hired to helper-e2e, escrowed, with runway", async ({ request, browser }, info) => {
  test.setTimeout(26 * 60_000); // a fresh fixture: Stripe TEST checkout + the 20-minute early-access window
  const poster = await getSession(request, "poster");
  const helper = await getSession(request, "helper");
  const { job, log } = await ensureAcceptedJob(request, browser, poster, helper);
  info.annotations.push({ type: "accepted-fixture", description: log.join("; ") });
  console.log(`[job-status-fixtures] accepted ${job.id} (date_needed ${job.date_needed}): ${log.join("; ")}`);
  // ensureAcceptedJob read the row back as accepted/escrow/helper-e2e; the
  // runway is what keeps auto-expire-jobs off it until the next run.
  expect(daysBetween(centralDatePlus(0), job.date_needed), `accepted fixture ${job.id} runway (days)`).toBeGreaterThanOrEqual(MIN_RUNWAY_DAYS);
});
