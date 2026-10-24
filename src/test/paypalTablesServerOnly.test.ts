/**
 * CLASS GUARD (PayPal Plan A phase 1): the provider tables are server-only, and
 * the paypal_payments switch is enforced in the database on the entry tables.
 *
 * Every migration, not only 20261023223419, is read (comments blanked): a LATER
 * migration that grants one of these tables to members or the anon key, or adds
 * a policy on it, fails here. Members never read PayPal ids or payout
 * destinations directly; screens get them through RPCs that check ownership.
 *
 * The switch trigger function is read at its NEWEST effective definition
 * (effectiveDefs: any dollar-quote tag, rewrites applied).
 *
 * @mutate supabase/migrations/20261023223419_paypal_provider_foundation.sql | ALTER TABLE public.payee_accounts ENABLE ROW LEVEL SECURITY; | ALTER TABLE public.payee_accounts DISABLE ROW LEVEL SECURITY;
 * @mutate supabase/migrations/20261023223419_paypal_provider_foundation.sql | public.payee_accounts, public.paypal_webhook_events FROM PUBLIC, anon, authenticated; | public.payee_accounts, public.paypal_webhook_events FROM PUBLIC; GRANT SELECT ON public.payee_accounts TO authenticated;
 * @mutate supabase/migrations/20261023223419_paypal_provider_foundation.sql | IF NOT public.feature_enabled_for_user('paypal_payments', v_member) THEN | IF false THEN
 * @mutate supabase/migrations/20261023223419_paypal_provider_foundation.sql | BEFORE INSERT OR UPDATE ON public.payee_accounts | BEFORE UPDATE ON public.payee_accounts
 * @mutate supabase/migrations/20261023223419_paypal_provider_foundation.sql |         NEW.verified := false;\n      END IF;\n    END IF; |       END IF;\n      NEW.verified := false; NEW.payable := false;\n    END IF;
 * @mutate supabase/migrations/20261023232438_paypal_refunds_and_helpr_fee.sql | RAISE EXCEPTION 'refund_after_payout_queued' | RAISE NOTICE 'refund_after_payout_queued'
 * @mutate supabase/migrations/20261023223419_paypal_provider_foundation.sql | BEFORE INSERT OR UPDATE ON public.provider_payouts | BEFORE DELETE ON public.provider_payouts
 * @mutate supabase/migrations/20261023223419_paypal_provider_foundation.sql | WHERE status IN ('capture_pending', 'captured', 'partially_refunded', 'disputed'); | WHERE false;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";

const MIG = path.resolve(__dirname, "../../supabase/migrations");
const TABLES = ["provider_payments", "provider_refunds", "provider_payouts", "payee_accounts", "paypal_webhook_events"];
const ENTRY: Record<string, RegExp> = {
  provider_payments: /CREATE\s+TRIGGER\s+\w+\s+BEFORE\s+INSERT\s+OR\s+UPDATE\s+ON\s+public\.provider_payments\s+FOR\s+EACH\s+ROW\s+EXECUTE\s+FUNCTION\s+public\.paypal_entry_requires_switch\(\)/i,
  payee_accounts: /CREATE\s+TRIGGER\s+\w+\s+BEFORE\s+INSERT\s+OR\s+UPDATE\s+ON\s+public\.payee_accounts\s+FOR\s+EACH\s+ROW\s+EXECUTE\s+FUNCTION\s+public\.paypal_entry_requires_switch\(\)/i,
};

const all = migrationFiles(MIG).map((f) => ({ f, sql: blankSqlComments(readFileSync(path.join(MIG, f), "utf8")) }));
const statements = all.flatMap(({ f, sql }) => sql.split(";").map((s) => ({ f, s: s.replace(/\s+/g, " ").trim() })));

describe("PayPal provider tables are server-only", () => {
  it("reads a real inventory (floors)", () => {
    expect(all.length).toBeGreaterThan(1000);
    for (const t of TABLES) {
      expect(statements.some(({ s }) => new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t}\\b`, "i").test(s)), t).toBe(true);
    }
  });

  it("each table has RLS on and is revoked from PUBLIC, anon and authenticated", () => {
    for (const t of TABLES) {
      expect(statements.some(({ s }) => new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`, "i").test(s)), `${t} RLS`).toBe(true);
      expect(statements.some(({ s }) => /^REVOKE ALL ON /i.test(s) && new RegExp(`public\\.${t}\\b`).test(s) && /FROM PUBLIC, anon, authenticated$/i.test(s)), `${t} revoke`).toBe(true);
      expect(statements.some(({ s }) => new RegExp(`ALTER TABLE public\\.${t} DISABLE ROW LEVEL SECURITY`, "i").test(s)), `${t} RLS disabled somewhere`).toBe(false);
    }
  });

  it("no migration grants them to members or anon, or adds a policy", () => {
    const bad = statements.filter(({ s }) =>
      TABLES.some((t) => new RegExp(`public\\.${t}\\b`).test(s))
      && (/^GRANT\b[\s\S]*\bTO\b[\s\S]*\b(anon|authenticated|PUBLIC)\b/i.test(s) || /^CREATE POLICY\b/i.test(s)),
    ).map(({ f, s }) => `${f}: ${s.slice(0, 120)}`);
    expect(bad).toEqual([]);
  });

  it("the entry tables refuse a member the paypal_payments switch is off for (newest definition)", () => {
    const def = effectiveDefs(MIG).get("paypal_entry_requires_switch");
    expect(def, "paypal_entry_requires_switch is defined").toBeTruthy();
    const body = blankSqlComments(def!.stmt);
    expect(body).toMatch(/IF\s+NOT\s+public\.feature_enabled_for_user\('paypal_payments',\s*v_member\)\s+THEN\s+RAISE\s+EXCEPTION\s+'feature_disabled'\s+USING\s+ERRCODE\s*=\s*'42501'/i);
    expect(body).toMatch(/SECURITY DEFINER/i);
    expect(body).toMatch(/SET search_path TO 'public'/i);
    // The verified reset runs only when who/where changed (the ELSE of the unchanged test), and
    // payable is never reset by the trigger: pp-phase2/pp-phase4 measured a body where the reset ran
    // on the turn-ON path too, so payable could never become true (2026-10-23).
    expect(body).toMatch(/NEW\.venmo_handle IS NOT DISTINCT FROM OLD\.venmo_handle THEN[\s\S]*?RETURN NEW;\s+END IF;\s+ELSE[\s\S]*?NEW\.verified := false;\s+END IF;/);
    expect(body).not.toMatch(/NEW\.payable\s*:=\s*false/);
    const joined = all.map((x) => x.sql).join("\n");
    for (const [t, re] of Object.entries(ENTRY)) expect(re.test(joined), `${t} trigger`).toBe(true);
    expect(statements.some(({ s }) => /^REVOKE ALL ON FUNCTION public\.paypal_entry_requires_switch\(\) FROM PUBLIC, anon, authenticated$/i.test(s))).toBe(true);
  });

  it("the money rules hold in the database (newest definitions)", () => {
    const defs = effectiveDefs(MIG);
    const payouts = blankSqlComments(defs.get("provider_payouts_guard")?.stmt ?? "");
    const refunds = blankSqlComments(defs.get("provider_refunds_guard")?.stmt ?? "");
    expect(payouts).toMatch(/RAISE EXCEPTION 'payout_exceeds_payment'/);
    expect(payouts).toMatch(/RAISE EXCEPTION 'payout_marked_paid_is_frozen'/);
    expect(payouts).toMatch(/RAISE EXCEPTION 'payout_destination_is_frozen'/);
    expect(refunds).toMatch(/RAISE EXCEPTION 'refund_after_payout_queued'/);
    expect(refunds).toMatch(/RAISE EXCEPTION 'refund_exceeds_payment'/);
    for (const body of [payouts, refunds]) {
      expect(body).toMatch(/SECURITY DEFINER/i);
      expect(body).toMatch(/FOR UPDATE/);
    }
    const joined = all.map((x) => x.sql).join("\n");
    expect(joined).toMatch(/CREATE TRIGGER trg_provider_payouts_guard\s+BEFORE INSERT OR UPDATE ON public\.provider_payouts\s+FOR EACH ROW EXECUTE FUNCTION public\.provider_payouts_guard\(\)/);
    expect(joined).toMatch(/CREATE TRIGGER trg_provider_refunds_guard\s+BEFORE INSERT OR UPDATE ON public\.provider_refunds\s+FOR EACH ROW EXECUTE FUNCTION public\.provider_refunds_guard\(\)/);
    expect(joined).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS provider_payments_one_funded_per_subject\s+ON public\.provider_payments \(subject_kind, subject_id\)\s+WHERE status IN \('capture_pending', 'captured', 'partially_refunded', 'disputed'\)/);
    for (const fn of ["provider_payouts_guard", "provider_refunds_guard"]) {
      expect(statements.some(({ s }) => new RegExp(`^REVOKE ALL ON FUNCTION public\\.${fn}\\(\\) FROM PUBLIC, anon, authenticated$`, "i").test(s)), fn).toBe(true);
    }
  });

  it("the switch is created OFF", () => {
    const ins = statements.find(({ s }) => /INSERT INTO public\.feature_switches/i.test(s) && /'paypal_payments'/.test(s));
    expect(ins?.s).toMatch(/\('paypal_payments', 'off',/);
  });
});
