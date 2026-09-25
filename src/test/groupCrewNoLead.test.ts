import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { walkSource } from "./helpers/walkSource";
import {
  CREW_COMPLETES_WHEN_HIRED_DONE,
  CREW_FEE_PAYS_UNCONFIRMED,
} from "../../supabase/functions/_shared/crewShares";

/**
 * THE CLASS: something a crew's "lead" gets that the rest of the crew does not.
 *
 * Owner decision, docs/OPEN.md Q407 (2026-09-25): a crew has NO lead. Every
 * hired member is equal in access, messaging the poster, pay share,
 * cancellation-fee share and review. Before 20260925154606, jobs.helper_id
 * named the first hire and every rule keyed on it handed that one member the
 * job row (UPDATE policy), the job-level completion (create-payment release),
 * the whole late-cancellation fee (void-cancelled-payments), the only review
 * and the proof-photo folder.
 *
 * The fix is structural: jobs.helper_id is NULL on every group job, enforced
 * in every context by trg_group_job_has_no_lead, so every helper_id-keyed rule
 * grants NOTHING on a crew and each crew need is built on the roster. These
 * are the standing guards, all read from the world:
 *
 *   1. the invariant: no writer, server included, can name a lead;
 *   2. an exact, two-way inventory of every function that authorises a caller
 *      through jobs.helper_id without reading the roster — each is dead on a
 *      crew by (1); a NEW one fails here until someone decides whether a crew
 *      needs its own version;
 *   3. the hire never writes helper_id, and freezes each member's share;
 *   4. the crew's fee, strike, completion, reviews and proof photos run on
 *      the roster; the two owner rules agree between SQL and TypeScript;
 *   5. the money paths (edge) read the roster: create-payment's escrow refund
 *      re-reads it after its claim, and a stuck claim pages.
 *
 * Behaviour (red before, 3x replay): src/test/pglite/groupCrewNoLead.pglite.mjs.
 */

// @mutate supabase/migrations/20260925154606_group_crew_has_no_lead.sql |   IF NEW.is_group_job IS TRUE AND NEW.helper_id IS NOT NULL THEN | IF public.is_server_context() THEN RETURN NEW; END IF;\n  IF NEW.is_group_job IS TRUE AND NEW.helper_id IS NOT NULL THEN
// @mutate supabase/migrations/20260925154606_group_crew_has_no_lead.sql |   BEFORE INSERT OR UPDATE OF helper_id, is_group_job, helpers_needed ON public.jobs |   BEFORE INSERT OR UPDATE OF helper_id ON public.jobs
// @mutate supabase/migrations/20260925154606_group_crew_has_no_lead.sql |     AND NOT public.is_server_context()\n     AND (OLD.payment_status IS DISTINCT FROM 'unpaid' |     AND false\n     AND (OLD.payment_status IS DISTINCT FROM 'unpaid'
// @mutate supabase/migrations/20260925154606_group_crew_has_no_lead.sql |   INSERT INTO public.group_job_helpers (job_id, helper_id, slot_no, share_cents) |   UPDATE public.jobs SET helper_id = v_helper_id WHERE id = v_job_id;\n  INSERT INTO public.group_job_helpers (job_id, helper_id, slot_no, share_cents)
// @mutate supabase/migrations/20260925154606_group_crew_has_no_lead.sql |         status = (CASE WHEN v_current >= v_needed THEN 'accepted' ELSE 'open' END)::job_status |         status = CASE WHEN v_current >= v_needed THEN 'accepted' ELSE 'open' END
// @mutate supabase/migrations/20260925154606_group_crew_has_no_lead.sql | AS $function$ SELECT true $function$;\n\n-- MEDIUM-4 | AS $function$ SELECT false $function$;\n\n-- MEDIUM-4
// @mutate supabase/migrations/20260925154606_group_crew_has_no_lead.sql |     INSERT INTO public.crew_cancellation_fee_shares\n      (job_id | --\n      (job_id
// @mutate supabase/migrations/20260925154606_group_crew_has_no_lead.sql |       ADD CONSTRAINT reviews_one_per_reviewee_per_job UNIQUE (job_id, reviewer_id, reviewee_id); |       ADD CONSTRAINT reviews_one_per_reviewee_per_job UNIQUE (job_id, reviewer_id);
// @mutate supabase/migrations/20260925154606_group_crew_has_no_lead.sql |     AND reviewer_id = NEW.reviewee_id\n |     AND true\n
// @mutate supabase/migrations/20260925154606_group_crew_has_no_lead.sql |       OR public.is_crew_member_of_job_folder(name)\n    )\n  );\n\nDROP POLICY IF EXISTS "Users can read | \n    )\n  );\n\nDROP POLICY IF EXISTS "Users can read
// @mutate src/components/PhotoProof.tsx |   if (crew) {\n    const { data, error } = await supabase.rpc( |   if (false) {\n    const { data, error } = await supabase.rpc(
// @mutate src/pages/jobs/appliedJobCard/steps/HelperPhotoAsk.tsx |       label="Before Photo"\n      crew={crew} |       label="Before Photo"
// @mutate supabase/functions/create-payment/index.ts |             await postSlackOpsAlert({\n              kind: "money_at_risk",\n              severity: "critical",\n              title: "Crew job stuck in 'cancelling' | console.log({\n              kind: "money_at_risk",\n              severity: "critical",\n              title: "Crew job stuck in 'cancelling'

const root = resolve(__dirname, "../..");
const MIGRATIONS = resolve(root, "supabase/migrations");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");
const EFFECTIVE = effectiveDefs(MIGRATIONS);
const body = (name: string) => blankSqlComments(EFFECTIVE.get(name)?.stmt ?? "");
const allMigrationSql = () =>
  readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ f, sql: blankSqlComments(read(`supabase/migrations/${f}`)) }));

/** A caller authorised through jobs.helper_id: `helper_id = auth.uid()` and its spellings. */
const HELPER_ID_KEYED =
  /\bhelper_id\s*(?:=|IS NOT DISTINCT FROM|IS DISTINCT FROM)\s*(?:\(SELECT auth\.uid\(\)\)|auth\.uid\(\)|v_uid|v_user|_user_id|_sender|_reviewer_id|_uid)\b|(?:auth\.uid\(\)|v_uid|v_user|_user_id)\s*(?:=|IS NOT DISTINCT FROM|IS DISTINCT FROM)\s*(?:\w+\.)?helper_id\b/i;

/**
 * Every function that authorises a caller through jobs.helper_id and never
 * reads the roster, with why that grants nothing to anyone on a crew. EXACT
 * and two-way: a new one fails until it is classified; a removed or
 * roster-aware one fails until it is taken off.
 */
const SINGLE_HELPER_ONLY: Record<string, string> = {
  block_user_and_settle: "settles a block against the single hired Helpr; a crew has none (Q408: crew block settlement)",
  can_review_job: "legacy, service_role only; the review gates are enforce_review_validity + the INSERT policy, both roster-aware",
  enforce_dispute_markers_server_owned: "a crew member cannot write jobs at all (no UPDATE policy match)",
  enforce_helper_completion_gates: "judges the single Helpr's job-level Done; a crew completes through the roster roll-up",
  enforce_helper_jobs_column_whitelist: "the single Helpr's jobs UPDATE whitelist; a crew member matches no jobs UPDATE policy",
  get_helper_parish_badges: "counts single-helper jobs toward a badge (Q408: crew jobs in badge counts)",
  helper_abort_job: "the single Helpr aborting; a crew member leaves through helper_cancel_booking's crew branch",
  helper_mark_on_the_way: "single-helper tracking; a crew uses rpc_group_member_on_the_way",
  instant_book_claim: "instant book is single-helper; the no-lead trigger refuses it on a group job",
  mark_helper_arrival: "single-helper arrival; a crew uses rpc_group_member_mark_arrival",
  prevent_job_field_escalation: "a crew member cannot write jobs at all",
  rpc_helper_mark_done: "single-helper Done; a crew uses rpc_group_member_mark_done",
  save_weekly_availability: "reads the caller's own single-helper bookings (Q408: crew bookings in availability)",
  user_has_pending_application: "a pending application, not a hire",
};

describe("a crew has no lead (Q407)", () => {
  it("1. no writer, the server included, can name a lead on a group job", () => {
    const fn = body("enforce_group_job_has_no_lead");
    expect(fn, "the invariant trigger function is gone").not.toHaveLength(0);
    const leadCheck = fn.indexOf("IF NEW.is_group_job IS TRUE AND NEW.helper_id IS NOT NULL THEN");
    expect(leadCheck).toBeGreaterThan(-1);
    // Context-free: nothing may return early before the lead check.
    expect(fn.slice(0, leadCheck), "a context early-return lets some writer name a lead").not.toMatch(/RETURN NEW|is_server_context/);
    // The shape lock: helpers_needed / is_group_job are fixed once funded or hired.
    expect(fn).toMatch(/NEW\.helpers_needed IS DISTINCT FROM OLD\.helpers_needed[\s\S]*NEW\.is_group_job IS DISTINCT FROM OLD\.is_group_job[\s\S]*NOT public\.is_server_context\(\)[\s\S]*group_job_helpers/);
    // The trigger that runs it, newest statement in the world.
    const creates = allMigrationSql().flatMap(({ sql }) =>
      [...sql.matchAll(/CREATE TRIGGER trg_group_job_has_no_lead\s+([\s\S]*?)\s+FOR EACH ROW EXECUTE FUNCTION (?:public\.)?(\w+)/gi)].map((m) => m),
    );
    expect(creates.length).toBeGreaterThan(0);
    const last = creates[creates.length - 1];
    expect(last[2]).toBe("enforce_group_job_has_no_lead");
    expect(last[1]).toMatch(/BEFORE INSERT OR UPDATE OF helper_id, is_group_job, helpers_needed ON public\.jobs/);
  });

  it("2. every function that authorises through jobs.helper_id without the roster is classified", () => {
    const found = [...EFFECTIVE.entries()]
      .filter(([, d]) => {
        const b = blankSqlComments(d.stmt);
        return HELPER_ID_KEYED.test(b) && !/group_job_helpers/i.test(b);
      })
      .map(([n]) => n)
      .sort();
    // Inventory floor: the class is real and the pattern still finds it.
    expect(found.length).toBeGreaterThan(10);
    expect(found, "an unclassified helper_id-keyed rule: decide whether a crew needs its own (roster) version").toEqual(
      Object.keys(SINGLE_HELPER_ONLY).sort(),
    );
    // And the rules a crew DOES need read the roster.
    for (const fn of ["is_party_to_job", "user_may_see_job_address", "can_message_in_job", "can_send_message_to_in_job", "enforce_review_validity", "poster_cancel_job", "apply_cancellation_violation_consequence", "is_crew_member_of_job_folder"]) {
      expect(body(fn), `${fn} no longer reads the roster`).toMatch(/group_job_helpers/);
    }
  });

  it("3. the hire adds a member, never a lead, and freezes that member's share", () => {
    const fn = body("accept_group_application");
    expect(fn, "accept_group_application writes jobs.helper_id again").not.toMatch(/\bhelper_id\s*=/);
    expect(fn).toMatch(/INSERT INTO public\.group_job_helpers \(job_id, helper_id, slot_no, share_cents\)/);
    expect(fn).toMatch(/public\.crew_slot_share_cents\(/);
    // The status CASE must be cast: a CASE of bare literals is text, which
    // Postgres will not assign to the job_status enum (every hire raised).
    expect(fn).toMatch(/\(CASE WHEN v_current >= v_needed THEN 'accepted' ELSE 'open' END\)::job_status/);
    // The split is exact: floor(T/N) + 1 cent for the first T mod N slots.
    expect(body("crew_slot_share_cents")).toMatch(/p_total_cents \/ GREATEST[\s\S]*p_slot < p_total_cents % GREATEST/);
    // Nobody but a server context moves a slot or a share.
    expect(body("freeze_crew_member_share")).toMatch(/NEW\.slot_no IS DISTINCT FROM OLD\.slot_no OR NEW\.share_cents IS DISTINCT FROM OLD\.share_cents[\s\S]*NOT public\.is_server_context\(\)/);
    // Every hire needs a funded job (the funding gate saw only the lead's write).
    expect(body("enforce_group_roster_award_gate")).toMatch(/job_payment_is_funded\(v_payment\)/);
  });

  it("4a. the owner rules are ONE place each, and SQL and TypeScript agree", () => {
    const sqlRule = (name: string) => {
      const m = /AS \$function\$\s*SELECT (true|false)\s*\$function\$/i.exec(EFFECTIVE.get(name)?.stmt ?? "");
      expect(m, `${name} is not a constant rule any more`).not.toBeNull();
      return m![1] === "true";
    };
    expect(sqlRule("crew_fee_pays_unconfirmed")).toBe(CREW_FEE_PAYS_UNCONFIRMED);
    expect(sqlRule("crew_completes_when_hired_done")).toBe(CREW_COMPLETES_WHEN_HIRED_DONE);
    expect(body("rpc_group_member_mark_done")).toMatch(/public\.crew_completes_when_hired_done\(\) AND v_filled >= 1/);
  });

  it("4b. a crew's late-cancellation fee is one ledger row per hired member, priced on their frozen share", () => {
    const fn = body("poster_cancel_job");
    const insertAt = fn.indexOf("INSERT INTO public.crew_cancellation_fee_shares");
    expect(insertAt, "poster_cancel_job no longer writes the crew ledger").toBeGreaterThan(-1);
    // The pricing branch: from its `IF v_crew THEN` to the single path's ELSE.
    const crewAt = fn.lastIndexOf("IF v_crew THEN", insertAt);
    expect(crewAt).toBeGreaterThan(-1);
    const crew = fn.slice(crewAt, fn.indexOf("ELSE", insertAt));
    expect(crew).toMatch(/INSERT INTO public\.crew_cancellation_fee_shares/);
    expect(crew).toMatch(/COALESCE\(g\.share_cents/);
    expect(crew).toMatch(/public\.crew_fee_pays_unconfirmed\(\) OR g\.helper_confirmed_at IS NOT NULL/);
    expect(crew, "the crew fee reads the (NULL) lead").not.toMatch(/v_job\.helper_id/);
    expect(fn).toMatch(/crew_fee_exceeds_budget/);
    // Nobody but poster_cancel_job writes the ledger.
    const writers = [...EFFECTIVE.entries()]
      .filter(([, d]) => /INSERT INTO public\.crew_cancellation_fee_shares/i.test(blankSqlComments(d.stmt)))
      .map(([n]) => n);
    expect(writers).toEqual(["poster_cancel_job"]);
  });

  it("4c. one review per Helpr: the key, the validity gate and the double-blind pairing", () => {
    const sql = allMigrationSql().map(({ sql }) => sql).join("\n");
    expect(sql).toMatch(/ADD CONSTRAINT reviews_one_per_reviewee_per_job UNIQUE \(job_id, reviewer_id, reviewee_id\)/);
    expect(sql).toMatch(/= ARRAY\['job_id', 'reviewer_id'\][\s\S]{0,200}DROP CONSTRAINT/);
    const validity = body("enforce_review_validity");
    expect(validity).toMatch(/IF v_job\.is_group_job IS TRUE THEN[\s\S]*v_reviewee_on_crew[\s\S]*v_reviewer_on_crew/);
    const reveal = body("set_review_visibility");
    expect(reveal, "the reveal pairs a review with any review naming its reviewer").toMatch(/AND reviewee_id = NEW\.reviewer_id\s+AND reviewer_id = NEW\.reviewee_id/);
  });

  it("4d. every crew member files and reads the job's proof photos, through their own roster row", () => {
    const sql = allMigrationSql();
    const lastPolicy = (name: string) =>
      sql.flatMap(({ sql: s }) => [...s.matchAll(new RegExp(`CREATE POLICY "${name}"[\\s\\S]*?;`, "g"))].map((m) => m[0])).slice(-1)[0] ?? "";
    expect(lastPolicy("Users can upload proof photos to own folder")).toMatch(/is_crew_member_of_job_folder\(name\)/);
    expect(lastPolicy("Users can read proof photos for their jobs")).toMatch(/is_crew_member_of_job_folder\(name\)/);
    // UPDATE/DELETE stay the uploader's own or a party's: no member edits another's evidence.
    expect(lastPolicy("Users can update their own proof photos")).not.toMatch(/is_crew_member_of_job_folder/);
    expect(lastPolicy("Users can delete their own proof photos")).not.toMatch(/is_crew_member_of_job_folder/);

    // Inventory from the client: every writer of jobs.proof_*_urls.
    const writers = walkSource([resolve(root, "src")], [".ts", ".tsx"])
      .filter((p) => !/\.test\.|\/test\//.test(p) && !/integrations\/supabase\/types\.ts$/.test(p))
      // An object-literal write key (`{ proof_before_urls: … }`), not a ternary.
      .filter((p) => /[{,]\s*proof_(before|after)_urls\s*:/.test(blankComments(readFileSync(p, "utf8"))))
      .map((p) => p.slice(root.length + 1));
    expect(writers.length).toBeGreaterThan(0);
    expect(writers, "a new client writer of jobs.proof_*_urls: route a crew through rpc_group_member_set_proof").toEqual(["src/components/PhotoProof.tsx"]);
    const photo = blankComments(read("src/components/PhotoProof.tsx"));
    expect(photo).toMatch(/if \(crew\) \{\s*const \{ data, error \} = await supabase\.rpc\(\s*"rpc_group_member_set_proof"/);
    const ask = blankComments(read("src/pages/jobs/appliedJobCard/steps/HelperPhotoAsk.tsx"));
    const chips = [...ask.matchAll(/<PhotoProofCaptureChip[\s\S]*?\/>/g)].map((m) => m[0]);
    expect(chips.length).toBeGreaterThanOrEqual(2);
    for (const c of chips) expect(c, "a photo ask that writes the JOB's photos on a crew").toMatch(/crew=\{crew\}/);
  });

  it("5. create-payment's escrow refund re-reads the crew after its claim, and a stuck claim pages", () => {
    const src = blankComments(read("supabase/functions/create-payment/index.ts"));
    const claim = src.indexOf('.update({ payment_status: "cancelling" })');
    const recheck = src.indexOf('.select("id, helper_id")', claim);
    expect(claim).toBeGreaterThan(-1);
    expect(recheck, "no post-claim crew read: a hire landing before the claim is refunded over").toBeGreaterThan(claim);
    expect(src.slice(recheck, recheck + 2500)).toMatch(/postSlackOpsAlert\(\{\s*kind: "money_at_risk",\s*severity: "critical",\s*title: "Crew job stuck in 'cancelling'/);
  });
});
