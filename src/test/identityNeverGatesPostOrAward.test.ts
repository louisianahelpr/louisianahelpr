// Identity verification never gates POSTING a job or the poster's HIRE.
// Since 2026-10-03 it gates exactly one thing: the Helpr's ACCEPT completes
// only once Stripe's ID check is done (owner: "in order to fully accept these
// 2 things must be done", payout setup and Stripe ID; docs/OPEN.md Q1180,
// 20261003193541, helper_accept_missing).
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
// posting or hiring, or spreading the accept's identity check beyond the
// accept. Each layer is read from the code that actually ships:
//   * DB policy  — the newest CREATE POLICY of every surviving jobs policy;
//   * DB function — the effective definition of every award-gate function
//                   (effectiveDefs replays rewrites and drops);
//   * client     — every non-test source file under src/, comments blanked.
//
// Identity stays as DISPLAY (badges, WorkRecord, admin review): reading
// `isIdentityVerified` to draw a pill is fine. What is forbidden is the gate
// vocabulary and the posting/award code paths consulting identity at all.
//
// @mutate supabase/migrations/20261001222911_remove_idv_requirement.sql |     RETURN 'helper_payout_setup_incomplete'; |     RETURN CASE WHEN public.identity_is_verified(NULL, NULL) THEN NULL ELSE 'helper_payout_setup_incomplete' END;
// @mutate supabase/migrations/20261003193541_accept_completes_after_stripe_setup.sql | CASE WHEN NOT public.identity_is_verified(p.idv_status, p.stripe_identity_verified) THEN 'stripe_id' END | NULL
// @mutate src/components/job-card/activityActions/useOfferHandlers.ts |       // Q1180 (owner, 2026-10-02/03): the server decides, in one call. |       // Q1180 (owner, 2026-10-02/03): the server decides, in one call.\n      void (user as { idv_status?: string } \| null)?.idv_status;
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { walkSource } from "./helpers/walkSource";
import { readdirSync } from "./helpers/trackedFiles";

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

describe("DB: the Hire never requires identity; the Accept does (Q1180)", () => {
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

  it("the poster's Hire (accept_application) never consults identity", () => {
    expect(blankSqlComments(defs.get("accept_application")!.stmt)).not.toMatch(IDENTITY_SQL);
  });

  it("the Helpr's Accept asks Stripe's ID check, in helper_accept_missing only", () => {
    expect(blankSqlComments(defs.get("helper_accept_missing")!.stmt))
      .toContain("public.identity_is_verified(p.idv_status, p.stripe_identity_verified)");
    const others = [...defs.entries()]
      .filter(([n]) => !["helper_accept_missing", "helper_accept_block_reason", "identity_is_verified"].includes(n))
      .filter(([n]) => /accept|award|hire/.test(n))
      .filter(([, d]) => /identity_is_verified|stripe_identity_verified|idv_status/.test(blankSqlComments(d.stmt)))
      .map(([n]) => n);
    expect(others).toEqual([]);
  });
});

describe("client: posting and hiring never gate on identity; only the accept mirror reads it", () => {
  const files = walkSource([join(REPO, "src")]).filter(
    (f) => !/\.test\.tsx?$/.test(f) && !f.includes(`${join("src", "test")}`) && !f.endsWith("integrations/supabase/types.ts"),
  );

  it("scans the app source", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("no source carries the retired ID-upload vocabulary; the accept's reason lives in awardGate.ts and its pop-up only", () => {
    const VOCAB = /IDVPromptDialog|verificationPromptFor|VerificationStatusRow|idvGate|setIdvDialogOpen/;
    const offenders = files
      .filter((f) => VOCAB.test(blankComments(readFileSync(f, "utf8"))))
      .map((f) => relative(REPO, f));
    expect(offenders).toEqual([]);
    const reasonUsers = files
      .filter((f) => /helper_identity_unverified/.test(blankComments(readFileSync(f, "utf8"))))
      .map((f) => relative(REPO, f));
    expect(reasonUsers.sort()).toEqual(["src/components/AwardGateDialog.tsx", "src/lib/awardGate.ts"]);
  });

  it("the post and hire code paths never read identity", () => {
    // useAwardBlockReason.ts is not here: since 20261003193541 it mirrors the
    // ACCEPT gate (helper_accept_block_reason), which does require the Stripe
    // ID, through acceptMissingFromProfile (Q1180 re-review nit).
    const PATHS = [
      "src/pages/post-job/",
      "src/hooks/useStripeConnectCheck.ts",
      "src/components/AwardGateDialog.tsx",
      "src/components/job-card/activityActions/useOfferHandlers.ts",
    ];
    const scoped = files.filter((f) => PATHS.some((p) => relative(REPO, f).startsWith(p)));
    expect(scoped.length).toBeGreaterThan(5);
    const IDENTITY_TS = /idv_status|idvStatus|stripe_identity_verified|isIdentityVerified\(/;
    const offenders = scoped
      .filter((f) => IDENTITY_TS.test(blankComments(readFileSync(f, "utf8"))))
      .map((f) => relative(REPO, f));
    expect(offenders).toEqual([]);
  });

  it("awardGate.ts reads identity only in the accept mirror (acceptMissingFromProfile) and the display predicate", () => {
    const code = blankComments(readFileSync(join(REPO, "src/lib/awardGate.ts"), "utf8"));
    const rest = code
      .replace(/export function isIdentityVerified\([\s\S]*?\n}\n/, "")
      .replace(/export function acceptMissingFromProfile\([\s\S]*?\n}\n/, "");
    expect(code).toMatch(/export function acceptMissingFromProfile\([\s\S]*?isIdentityVerified\(/);
    expect(rest).not.toMatch(/idv_status|idvStatus|stripe_identity_verified|isIdentityVerified\(/);
  });
});
