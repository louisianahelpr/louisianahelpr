// Identity verification gates NOTHING: not posting a job, not being hired.
//
// Owner, 2026-10-01: "Remove finish verifying id we don't do that anymore."
// Before that, measured live on prod (pg_policies / pg_get_functiondef):
//
//   jobs INSERT "Customers can create jobs"   EXISTS(profiles.idv_status = 'verified')
//   helper_award_block_reason(uuid)           'helper_identity_unverified' arm
//
// and the client mirrored both: useJobSubmit pre-checked idv_status and opened
// IDVPromptDialog, awardGate.ts carried a `helper_identity_unverified` reason,
// AwardGateDialog drew an "Identity verified by Stripe" checklist row, and
// Profile showed a "Verify your ID." banner.
//
// The CLASS this guards: any layer re-introducing an identity requirement on
// the two core actions. Each layer is read from the code that actually ships:
//   * DB policy  — the newest CREATE POLICY of every surviving jobs policy;
//   * DB function — the effective definition of every award-gate function
//                   (effectiveDefs replays rewrites and drops);
//   * client     — every non-test source file under src/, comments blanked.
//
// Identity stays as DISPLAY (badges, WorkRecord, admin review): reading
// `isIdentityVerified` to draw a pill is fine. What is forbidden is the gate
// vocabulary and the posting/award code paths consulting identity at all.
//
// @mutate src/lib/awardGate.ts | export function awardBlockReasonFromStatus( | export const helper_identity_unverified = 1;\nexport function awardBlockReasonFromStatus(
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { walkSource } from "./helpers/walkSource";

const REPO = resolve(process.cwd());
const MIG = join(REPO, "supabase", "migrations");

/** Any reference to the identity columns or the identity refusal code. */
const IDENTITY_SQL = /idv_status|stripe_identity_verified|id_verification_status|helper_identity_unverified|identity_is_verified/i;

describe("DB: jobs policies never require identity", () => {
  // Replay every migration: CREATE POLICY sets, DROP POLICY removes. Keyed by
  // policy name on public.jobs.
  const policies = new Map<string, { file: string; stmt: string }>();
  const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const code = blankSqlComments(readFileSync(join(MIG, f), "utf8"));
    const re = /(create|drop)\s+policy\s+(?:if\s+exists\s+)?"([^"]+)"\s+on\s+(?:public\.)?"?(\w+)"?[\s\S]*?;/gi;
    for (const m of code.matchAll(re)) {
      if (m[3].toLowerCase() !== "jobs") continue;
      if (m[1].toLowerCase() === "drop") policies.delete(m[2]);
      else policies.set(m[2], { file: f, stmt: m[0] });
    }
  }

  it("finds the jobs policies, including the INSERT one", () => {
    expect(policies.size).toBeGreaterThan(3);
    expect(policies.has("Customers can create jobs")).toBe(true);
  });

  it("no surviving jobs policy consults identity", () => {
    const offenders = [...policies]
      .filter(([, p]) => IDENTITY_SQL.test(p.stmt))
      .map(([name, p]) => `${name} (${p.file})`);
    expect(offenders).toEqual([]);
  });

  it("the INSERT policy still pins ownership and the block check", () => {
    const stmt = policies.get("Customers can create jobs")!.stmt;
    expect(stmt).toMatch(/auth\.uid\(\)[\s\S]*=\s*customer_id/i);
    expect(stmt).toMatch(/are_users_blocked/);
  });
});

describe("DB: the award gate never requires identity", () => {
  const defs = effectiveDefs(MIG);
  const gates = [...defs.keys()].filter((n) => /award_block_reason|award_gate/.test(n));

  it("finds the award-gate functions", () => {
    expect(gates).toEqual(expect.arrayContaining([
      "helper_award_block_reason",
      "enforce_helper_award_gate",
      "enforce_group_roster_award_gate",
    ]));
  });

  it.each(gates)("%s does not consult identity", (fn) => {
    expect(blankSqlComments(defs.get(fn)!.stmt)).not.toMatch(IDENTITY_SQL);
  });

  it("helper_award_block_reason still refuses an unpaid-out Helpr", () => {
    expect(blankSqlComments(defs.get("helper_award_block_reason")!.stmt))
      .toContain("helper_payout_setup_incomplete");
  });
});

describe("client: no posting or award path gates on identity", () => {
  const files = walkSource([join(REPO, "src")]).filter(
    (f) => !/\.test\.tsx?$/.test(f) && !f.includes(`${join("src", "test")}`) && !f.endsWith("integrations/supabase/types.ts"),
  );

  it("scans the app source", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("no source carries the identity gate vocabulary", () => {
    const VOCAB = /helper_identity_unverified|IDVPromptDialog|verificationPromptFor|VerificationStatusRow|idvGate|setIdvDialogOpen/;
    const offenders = files
      .filter((f) => VOCAB.test(blankComments(readFileSync(f, "utf8"))))
      .map((f) => relative(REPO, f));
    expect(offenders).toEqual([]);
  });

  it("the post and award code paths never read identity", () => {
    const PATHS = [
      "src/pages/post-job/",
      "src/lib/awardGate.ts",
      "src/hooks/useAwardBlockReason.ts",
      "src/hooks/useStripeConnectCheck.ts",
      "src/components/AwardGateDialog.tsx",
      "src/components/job-card/activityActions/useOfferHandlers.ts",
    ];
    const scoped = files.filter((f) => PATHS.some((p) => relative(REPO, f).startsWith(p)));
    expect(scoped.length).toBeGreaterThan(5);
    const IDENTITY_TS = /idv_status|idvStatus|stripe_identity_verified|isIdentityVerified\(/;
    const offenders = scoped
      .filter((f) => {
        const code = blankComments(readFileSync(f, "utf8"));
        // awardGate.ts may still DEFINE the display predicate; it may not call it.
        const body = relative(REPO, f) === "src/lib/awardGate.ts"
          ? code.replace(/export function isIdentityVerified\([\s\S]*?\n}\n/, "")
          : code;
        return IDENTITY_TS.test(body);
      })
      .map((f) => relative(REPO, f));
    expect(offenders).toEqual([]);
  });
});
