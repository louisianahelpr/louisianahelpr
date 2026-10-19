/**
 * Q2082 (b), owner pop-up 2026-10-18 ("J4"): HELPR FAULT. After the poster
 * reports a no-show or a backout, an ADMIN marks the Helpr at fault; then the
 * poster gets a FULL refund (the card fee and its tax too), the Helpr is billed
 * the card fee Stripe kept, and the Helpr carries a strike. Never a fee the
 * platform absorbs.
 *
 * Read from the NEWEST definitions (any dollar-quote tag, comments blanked):
 *   - admin_rule_helpr_fault is admin-only, writes one ruling per job, audits,
 *     and gives the Helpr exactly one strike for the job;
 *   - bill_helpr_fault_card_fee bills once (a replay returns 0), caps the fee
 *     at the charge, and is callable by service_role only;
 *   - create-payment's admin_refund_general takes `helprFault` for a FULL
 *     refund only, and tells the poster everything comes back.
 * The refund amount and the ruling-before / billing-after order are guarded by
 * refundsKeepTheCardFee.test.ts (kind "helpr-fault").
 *
 * @mutate supabase/migrations/20261019015301_helpr_fault_ruling.sql |   IF v_admin IS NULL OR NOT public.has_role(v_admin, 'admin'::app_role) THEN | IF v_admin IS NULL THEN
 * @mutate supabase/migrations/20261019015301_helpr_fault_ruling.sql |   -- Exactly one strike for this job: the report or the backout usually wrote it.\n  IF NOT EXISTS ( |   IF EXISTS (
 * @mutate supabase/migrations/20261019015301_helpr_fault_ruling.sql |   IF r.card_fee_cents IS NOT NULL THEN\n    RETURN 0; |   IF false THEN\n    RETURN 0;
 * @mutate supabase/migrations/20261019015301_helpr_fault_ruling.sql |   v_fee := least(p_card_fee_cents, COALESCE(v_cap, 0)); |   v_fee := p_card_fee_cents;
 * @mutate supabase/migrations/20261019015301_helpr_fault_ruling.sql | REVOKE ALL ON FUNCTION public.bill_helpr_fault_card_fee(uuid, integer, text) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.bill_helpr_fault_card_fee(uuid, integer, text) FROM PUBLIC, anon;
 * @mutate supabase/migrations/20261019015301_helpr_fault_ruling.sql |   job_id uuid NOT NULL UNIQUE REFERENCES public.jobs(id) ON DELETE CASCADE, |   job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
 * @mutate supabase/functions/create-payment/index.ts |       if (helprFault && typeof amountCents === "number") { |       if (false) {
 * @mutate supabase/functions/create-payment/index.ts |                 : "The Helpr was at fault, so the card processing fee comes back to you too.") |                 : "")
 * @mutate supabase/migrations/20261019015301_helpr_fault_ruling.sql |     IF v_existing.helper_id IS NULL OR v_existing.helper_id = p_helper_id THEN |     IF v_existing.helper_id = p_helper_id THEN
 * @mutate supabase/functions/create-payment/index.ts |           if (helprFault && !helprFaultGone) helprFaultCardFeeCents = actualOrEstimatedFeeCents(pi, capturedCents); |           if (helprFault) helprFaultCardFeeCents = actualOrEstimatedFeeCents(pi, capturedCents);
 * @mutate supabase/functions/create-payment/index.ts |         disputeHelprFaultGone = ruled.gone; |         disputeHelprFaultGone = false;
 * @mutate supabase/functions/create-payment/index.ts |       const disputeHelprFaultLive = disputeHelprFault != null && !disputeHelprFaultGone; |       const disputeHelprFaultLive = disputeHelprFault != null;
 * @mutate supabase/functions/create-payment/index.ts |   return data.helper_id == null; |   return false;
 * @mutate supabase/functions/create-payment/index.ts |             const disputeEffectiveSplit = disputeHelprFaultLive ? helprFaultDisputeSplit : disputeSplit; |             const disputeEffectiveSplit = disputeSplit;
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { latestFunctionDefs } from "./helpers/rpcErrorInventory";

const ROOT = join(__dirname, "..", "..");
const MIG = join(ROOT, "supabase", "migrations");
const norm = (s: string) => s.replace(/\s+/g, " ");

const defs = latestFunctionDefs(MIG);
const body = (fn: string) => norm(blankSqlComments(defs.get(fn)?.body ?? ""));

/** Every GRANT/REVOKE on a function, in apply order, comments blanked. */
function aclStatements(fn: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(MIG).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = norm(blankSqlComments(readFileSync(join(MIG, f), "utf8")));
    for (const m of sql.matchAll(new RegExp(`\\b(?:GRANT|REVOKE)\\b[^;]*?ON FUNCTION (?:public\\.)?${fn}\\s*\\([^;]*;`, "gi"))) out.push(m[0]);
  }
  return out;
}

/** The newest CREATE TABLE of a table (comments blanked). */
function newestTable(table: string): string {
  let last = "";
  for (const f of readdirSync(MIG).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = blankSqlComments(readFileSync(join(MIG, f), "utf8"));
    const m = sql.match(new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`, "i"));
    if (m) last = norm(m[1]);
  }
  return last;
}

describe("Q2082 (b): Helpr at fault = full refund, Helpr billed the card fee, one strike", () => {
  it("the inventory is read from the newest definitions", () => {
    const fns = ["admin_rule_helpr_fault", "bill_helpr_fault_card_fee"].filter((f) => body(f).length > 200);
    expect(fns.length).toBeGreaterThan(1);
  });

  it("only an admin rules, once per job, with an audit row", () => {
    const b = body("admin_rule_helpr_fault");
    expect(b).toMatch(/IF v_admin IS NULL OR NOT public\.has_role\(v_admin, 'admin'::app_role\) THEN RAISE EXCEPTION 'not_authorized'/);
    expect(newestTable("job_helpr_fault_rulings")).toMatch(/job_id uuid NOT NULL UNIQUE/);
    expect(b).toMatch(/INSERT INTO public\.admin_audit_log/);
  });

  it("the Helpr carries exactly one strike for the job (added only when the report or backout left none)", () => {
    const b = body("admin_rule_helpr_fault");
    expect(b).toMatch(/IF NOT EXISTS \( SELECT 1 FROM public\.user_violations v WHERE v\.user_id = p_helper_id AND v\.job_id = p_job_id AND v\.violation_type IN \('no_show', 'job_denial'\)\) THEN [^;]*;? ?INSERT INTO public\.user_violations|IF NOT EXISTS \( SELECT 1 FROM public\.user_violations v WHERE v\.user_id = p_helper_id AND v\.job_id = p_job_id AND v\.violation_type IN \('no_show', 'job_denial'\)\) THEN PERFORM set_config\('app\.trusted_ladder_write', 'on', true\); INSERT INTO public\.user_violations/);
  });

  it("the Helpr is billed the card fee once, capped at the charge, by service_role only", () => {
    const b = body("bill_helpr_fault_card_fee");
    expect(b).toMatch(/IF r\.card_fee_cents IS NOT NULL THEN RETURN 0;/);
    expect(b).toMatch(/v_fee := least\(p_card_fee_cents, COALESCE\(v_cap, 0\)\);/);
    const acl = aclStatements("bill_helpr_fault_card_fee");
    const last = acl.filter((s) => /authenticated/i.test(s)).pop() ?? "";
    expect(last, "authenticated must end REVOKEd on bill_helpr_fault_card_fee").toMatch(/^REVOKE/i);
    expect(acl.some((s) => /^GRANT EXECUTE[^;]*TO service_role;/i.test(s))).toBe(true);
  });

  it("the edge refund is full-only and tells the poster the card fee comes back", () => {
    const code = norm(blankComments(readFileSync(join(ROOT, "supabase/functions/create-payment/index.ts"), "utf8")));
    expect(code).toMatch(/if \(helprFault && typeof amountCents === "number"\) \{ throw new PublicError\(/);
    expect(code).toContain(': "The Helpr was at fault, so the card processing fee comes back to you too.")');
  });

  // Owner 2026-10-18 ~22:30Z: the Helpr's account is deleted (nobody to bill)
  // -> the refund is MINUS the card fee (we never absorb one).
  it("a Helpr whose account is gone: the ruling stands, the refund keeps the card fee and bills nothing", () => {
    const b = body("admin_rule_helpr_fault");
    expect(b).toMatch(/IF v_existing\.helper_id IS NULL OR v_existing\.helper_id = p_helper_id THEN RETURN jsonb_build_object\('outcome', 'already_ruled'/);
    const code = norm(blankComments(readFileSync(join(ROOT, "supabase/functions/create-payment/index.ts"), "utf8")));
    const fn = code.slice(code.indexOf("async function helprFaultHelprIsGone"));
    expect(fn).toMatch(/^async function helprFaultHelprIsGone\([^)]*\): Promise<boolean \| null> \{ const \{ data, error \} = await supabaseAdmin \.from\("job_helpr_fault_rulings"\)\.select\("helper_id"\)\.eq\("job_id", jobId\)\.maybeSingle\(\); if \(error \|\| !data\) \{[\s\S]*?return null; \} return data\.helper_id == null; \}/);
    // Read once, right after the ruling (ruleHelprFaultFirst) and BEFORE the
    // claim / refund, in BOTH actions; an unreadable ruling moves nothing.
    const rule = code.slice(code.indexOf("async function ruleHelprFaultFirst("));
    expect(rule).toMatch(/await asAdmin\.rpc\("admin_rule_helpr_fault"[\s\S]*?const gone = await helprFaultHelprIsGone\(supabaseAdmin, jobId\); if \(gone === null\) \{ return \{ refusal: new Response\([^;]*status: 503 \}\) \}; \} return \{ gone \}; \}/);
    for (const [action, call, flag] of [
      ["admin_refund_general", "const ruled = await ruleHelprFaultFirst(authHeader, supabaseAdmin, jobId, helprFault); if (\"refusal\" in ruled) return ruled.refusal; helprFaultGone = ruled.gone;", "helprFaultGone"],
      ["admin_refund_dispute", "const ruled = await ruleHelprFaultFirst(authHeader, supabaseAdmin, jobId, disputeHelprFault); if (\"refusal\" in ruled) return ruled.refusal; disputeHelprFaultGone = ruled.gone;", "disputeHelprFaultGone"],
    ]) {
      const start = code.indexOf(`if (action === "${action}")`);
      const end = code.indexOf("if (action === \"", start + 10);
      const block = code.slice(start, end > 0 ? end : undefined);
      const at = block.indexOf(call);
      expect(at, `${action} rules (and reads ${flag}) before any refund`).toBeGreaterThan(0);
      expect(at).toBeLessThan(block.indexOf("stripe.refunds.create("));
    }
    // Gone: the ordinary fee-keeping split, and no card fee to bill.
    expect(code).toContain("const split = helprFault && !helprFaultGone ? helprFaultSplit : generalSplit;");
    expect(code).toContain("if (helprFault && !helprFaultGone) helprFaultCardFeeCents = actualOrEstimatedFeeCents(pi, capturedCents);");
    expect(code).toContain("const disputeHelprFaultLive = disputeHelprFault != null && !disputeHelprFaultGone;");
    expect(code).toContain("const disputeEffectiveSplit = disputeHelprFaultLive ? helprFaultDisputeSplit : disputeSplit;");
    expect(code).toContain("if (disputeHelprFaultLive) disputeHelprFaultCardFeeCents = actualOrEstimatedFeeCents(pi, capturedCents);");
    expect(code).toContain("const disputeSendCents = disputeHelprFaultLive ? helprFaultDisputeRefundCents : refundAmount;");
  });
});
