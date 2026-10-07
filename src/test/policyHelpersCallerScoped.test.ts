/**
 * Q1328: has_role, user_may_see_job_address and group_member_slot are
 * SECURITY DEFINER policy helpers that authenticated may EXECUTE (policies call
 * them with auth.uid()). Called directly, they answered about ANY id: who is an
 * admin, who is hired or offered on a job, who is on a crew. Their newest
 * definitions must answer only when the id asked about is the caller, or the
 * caller is the server or an admin (group_member_slot also for the job's
 * poster, which rpc_poster_confirm_member_arrival and the reviews INSERT policy
 * rely on), and the three are no longer listed as "unscoped".
 *
 * Behaviour (real Postgres, token swap): src/test/pglite/policyHelpersCallerScoped.pglite.mjs
 * (21 PASS applied 3x; NEW_MIGRATION=skip gives 5 FAILED, the live state).
 *
 * @mutate supabase/migrations/20261007132616_policy_helpers_answer_only_for_the_caller.sql |     WHEN COALESCE(\n           _user_id = auth.uid()\n           OR public.is_server_context() |     WHEN COALESCE(\n           true\n           OR public.is_server_context()
 * @mutate supabase/migrations/20261007132616_policy_helpers_answer_only_for_the_caller.sql |   SELECT _user_id IS NOT NULL\n    AND COALESCE( |   SELECT _user_id IS NOT NULL\n    AND true OR COALESCE(
 * @mutate supabase/migrations/20261007132616_policy_helpers_answer_only_for_the_caller.sql |     AND g.helper_id = _user_id\n    AND COALESCE( |     AND g.helper_id = _user_id\n    AND true OR COALESCE(
 * @mutate scripts/ci/definer-exec-allowlist.json |   "unscoped": { |   "unscoped": {\n    "has_role(uuid, app_role)": "reviewed 2026-10-05 (Q1284): policy helper used by every admin policy with auth.uid().",
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs("supabase/migrations");
const body = (name: string) => blankSqlComments(defs.get(name)?.stmt ?? "").replace(/\s+/g, " ");
const HELPERS = ["has_role", "user_may_see_job_address", "group_member_slot"] as const;

// The scope clause, as one COALESCE(...) gate ANDed in front of the answer:
// "the id is the caller OR server context OR the caller is an admin".
const SCOPE =
  /AND COALESCE\( _user_id = auth\.uid\(\) OR public\.is_server_context\(\) (?:OR EXISTS \(SELECT 1 FROM public\.jobs j WHERE j\.id = _job_id AND j\.customer_id = auth\.uid\(\)\) )?OR EXISTS \(SELECT 1 FROM public\.user_roles r WHERE r\.user_id = auth\.uid\(\) AND r\.role = 'admin'::public\.app_role\), false\)/;

describe("Q1328: policy helpers answer only about the caller", () => {
  it("inventory: the three helpers are defined (floor)", () => {
    for (const n of HELPERS) expect(body(n).length, n).toBeGreaterThan(150);
  });

  it("user_may_see_job_address and group_member_slot AND the scope gate into their answer", () => {
    expect(body("user_may_see_job_address")).toMatch(new RegExp(`SELECT _user_id IS NOT NULL ${SCOPE.source}`));
    expect(body("group_member_slot")).toMatch(new RegExp(`AND g\\.helper_id = _user_id ${SCOPE.source}`));
  });

  it("group_member_slot also answers the job's poster (poster arrival confirm, reviews policy)", () => {
    expect(body("group_member_slot")).toMatch(/j\.customer_id = auth\.uid\(\)/);
  });

  it("has_role answers its EXISTS only behind the scope gate, and false otherwise (never NULL)", () => {
    const b = body("has_role");
    expect(b).toMatch(
      /WHEN _user_id IS NULL THEN false WHEN COALESCE\( _user_id = auth\.uid\(\) OR public\.is_server_context\(\) OR EXISTS \(SELECT 1 FROM public\.user_roles r WHERE r\.user_id = auth\.uid\(\) AND r\.role = 'admin'::public\.app_role\), false\) THEN EXISTS/,
    );
    expect(b).toMatch(/ELSE false END/);
  });

  it("none of the three is listed as unscoped any more", () => {
    const allow = JSON.parse(readFileSync("scripts/ci/definer-exec-allowlist.json", "utf8")) as {
      unscoped: Record<string, string>;
      authenticated: Record<string, string>;
    };
    const listed = Object.keys(allow.unscoped).filter((sig) => HELPERS.some((h) => sig.startsWith(`${h}(`)));
    expect(listed).toEqual([]);
    for (const h of HELPERS) expect(Object.keys(allow.authenticated).some((sig) => sig.startsWith(`${h}(`)), h).toBe(true);
  });
});
