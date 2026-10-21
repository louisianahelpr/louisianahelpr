/**
 * CLASS CHECK: Stripe Identity (photo ID + selfie) gates a member's FIRST
 * accepted job, their own job POST, and a Helpr's On the way (owner,
 * 2026-10-21), and nothing else. Payout setup is not an ID check.
 *
 * Read from the code that ships (effective SQL definitions, the migrations'
 * CREATE TRIGGER statements, the edge function), comments blanked:
 *   1. THE RULE identity_is_verified is idv_status = 'verified' alone.
 *   2. POST: a BEFORE INSERT trigger on jobs judges only the member's OWN post,
 *      never a server write, an admin, or an enrolled test account.
 *   3. START: BEFORE UPDATE triggers on jobs and the crew roster fire only on
 *      the departure/arrival stamps and status, and judge only when the ACTING
 *      member is the Helpr. The poster's confirm/release columns are not in the
 *      list, so a poster is never held by the Helpr's ID, and the day-of
 *      confirm (helper_dayof_confirmed_at) is never gated (confirm first).
 *   4. THE $2: stripe-idv-start no longer asks for the poster's setup fee first,
 *      and nothing on the Identity path writes onboarding_fee_paid, so the $2 is
 *      still charged once, at the first job's checkout (create-payment).
 *
 * Behaviour: src/test/pglite/identityBeforeAcceptPostAndStart.pglite.mjs
 * (13 [fix] checks red before the migration, all green after, 3x replay).
 *
 * @mutate supabase/migrations/20261021081258_stripe_identity_before_first_accept_post_and_start.sql |   SELECT p_idv_status IS NOT DISTINCT FROM 'verified' AND p_stripe_identity_verified IS NOT NULL; |   SELECT p_idv_status IS NOT DISTINCT FROM 'verified' OR p_stripe_identity_verified IS TRUE;
 * @mutate supabase/migrations/20261021081258_stripe_identity_before_first_accept_post_and_start.sql |   IF NEW.helper_id IS NULL OR auth.uid() IS DISTINCT FROM NEW.helper_id THEN |   IF NEW.helper_id IS NULL THEN
 * @mutate supabase/migrations/20261021081258_stripe_identity_before_first_accept_post_and_start.sql |   BEFORE UPDATE OF helper_on_the_way_at, helper_arrived_at, status ON public.jobs |   BEFORE UPDATE ON public.jobs
 * @mutate supabase/functions/stripe-idv-start/index.ts |     const skipFeeGate = true; |     const skipFeeGate = false;
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const REPO = resolve(__dirname, "..", "..");
const MIG = join(REPO, "supabase", "migrations");
const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");
const defs = effectiveDefs(MIG);
const body = (fn: string) => {
  const d = defs.get(fn);
  if (!d) throw new Error(`${fn}: no effective definition`);
  return flat(d.stmt);
};

/** The newest CREATE TRIGGER <name>, flattened. */
function trigger(name: string): string {
  let last = "";
  for (const f of readdirSync(MIG).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = blankSqlComments(readFileSync(join(MIG, f), "utf8"));
    for (const m of sql.matchAll(new RegExp(`CREATE TRIGGER ${name}\\b[\\s\\S]*?;`, "gi"))) last = m[0];
  }
  return last.replace(/\s+/g, " ");
}

describe("Stripe Identity gates the first accept, a post and On the way (owner 2026-10-21)", () => {
  it("THE RULE: identity_is_verified is Stripe Identity alone", () => {
    const rule = body("identity_is_verified");
    expect(rule).toContain("SELECT p_idv_status IS NOT DISTINCT FROM 'verified' AND p_stripe_identity_verified IS NOT NULL;");
    expect(rule).not.toMatch(/OR p_stripe_identity_verified/);
  });

  it("POST: a member's own insert, never a server write, an admin or a test account", () => {
    const fn = body("enforce_identity_before_post");
    expect(fn).toMatch(/IF public\.is_server_context\(\) OR auth\.uid\(\) IS NULL THEN RETURN NEW;/);
    expect(fn).toMatch(/IF NEW\.customer_id IS DISTINCT FROM auth\.uid\(\) THEN RETURN NEW;/);
    expect(fn).toMatch(/public\.has_role\(auth\.uid\(\), 'admin'\) OR public\.identity_check_exempt\(auth\.uid\(\)\)/);
    expect(fn).toMatch(/IF NOT public\.is_identity_verified\(auth\.uid\(\)\) THEN RAISE EXCEPTION 'identity_required_to_post'/);
    expect(trigger("trg_jobs_identity_before_post")).toMatch(/BEFORE INSERT ON public\.jobs FOR EACH ROW EXECUTE FUNCTION public\.enforce_identity_before_post\(\)/);
  });

  it("START: only the departure/arrival stamps and status, only when the acting member is the Helpr", () => {
    const fn = body("enforce_identity_before_start");
    expect(fn).toMatch(/IF NEW\.helper_id IS NULL OR auth\.uid\(\) IS DISTINCT FROM NEW\.helper_id THEN RETURN NEW;/);
    expect(fn).toMatch(/RAISE EXCEPTION 'identity_required_to_start'/);
    const jobs = trigger("trg_jobs_identity_before_start");
    const crew = trigger("trg_crew_identity_before_start");
    expect(jobs).toMatch(/BEFORE UPDATE OF helper_on_the_way_at, helper_arrived_at, status ON public\.jobs /);
    expect(crew).toMatch(/BEFORE UPDATE OF helper_on_the_way_at, helper_arrived_at ON public\.group_job_helpers /);
    // Confirm first (owner): the day-of confirm and every poster column stay ungated.
    for (const t of [jobs, crew]) expect(t).not.toMatch(/dayof|poster_|released|payment_status|helper_confirmed_at/);
  });

  it("the test-account carve-out is the enrolled one, not is_seed alone", () => {
    expect(body("identity_check_exempt")).toMatch(/p\.is_seed IS TRUE AND EXISTS \(SELECT 1 FROM public\.test_accounts t WHERE t\.user_id = p\.user_id\)/);
  });

  it("THE $2: the ID check never asks for, writes or skips the poster's setup fee", () => {
    const start = blankComments(readFileSync(join(REPO, "supabase/functions/stripe-idv-start/index.ts"), "utf8"));
    expect(start).toMatch(/const skipFeeGate = true;/);
    for (const f of ["stripe-idv-start/index.ts", "stripe-idv-webhook/index.ts"]) {
      expect(blankComments(readFileSync(join(REPO, "supabase/functions", f), "utf8"))).not.toMatch(/onboarding_fee_paid/);
    }
    expect(body("claim_idv_attempt")).not.toMatch(/SET[^;]*onboarding_fee_paid/);
    // ...and the first job's checkout still charges it from the same column.
    const pay = blankComments(readFileSync(join(REPO, "supabase/functions/create-payment/index.ts"), "utf8"));
    expect(pay).toMatch(/const owesOnboardingFee = !!posterProfile && !posterProfile\.onboarding_fee_paid && onboardingFeeCents > 0;/);
  });
});
