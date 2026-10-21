/**
 * CLASS CHECK: every identity gate in the app reads ONE rule (owner 2026-10-19:
 * "a Stripe ID verification done ONCE is valid across the board, every section,
 * and is never asked again"; and an admin-APPROVED uploaded ID counts the same).
 *
 * THE RULE. SQL: public.identity_is_verified(idv_status, stripe_identity_verified)
 * (looked up per user by public.is_identity_verified(uuid)); since 2026-10-21 it
 * is Stripe Identity ONLY (idv_status = 'verified'; the Connect argument is
 * ignored, 20261021081258). Client: hasIdBadge (src/lib/awardGate.ts), the same. An admin approval of a
 * landlord's ID photo (rentals_admin_review_landlord_id, 20261019051407) writes
 * idv_status = 'verified' exactly as admin-user-actions manual_verify does, so
 * it passes every gate through the rule without a second copy.
 *
 * THE BUG CLASS. A gate that tests one verdict column itself drifts from the
 * rule: helperTier's rung read stripe_identity_verified alone (an ID-verified
 * member without Connect showed no "Verified" rung); claim_idv_attempt and
 * stripe-idv-start's "already verified" read idv_status alone, so a Connect-
 * verified member could be sent through a second ID check.
 *
 * INVENTORY (from source, comments blanked with the shared helpers):
 *   SQL   every function's EFFECTIVE definition (effectiveDefs) and every
 *         policy statement in supabase/migrations: a comparison of idv_status
 *         with 'verified' or a truth test of stripe_identity_verified.
 *   TS    every non-test .ts/.tsx under src/ and supabase/functions/: the same
 *         comparisons, a .eq() filter on them, and an if() on the Connect flag.
 * Each hit must be in its EXACT allowlist (two-way), each entry saying why it is
 * not a gate (the rule itself, a verdict WRITER, or Stripe's own Connect sync).
 *
 * @mutate src/lib/helperTier.ts |   if (!tierIdentityVerified(profile)) return false; |   if (profile.stripe_identity_verified !== true) return false;
 * @mutate supabase/migrations/20261019051407_rentals_landlord_id_review.sql |   IF public.identity_is_verified(v_status, v_connect) THEN | IF v_status = 'verified' THEN
 */
import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { readdirSync } from "./helpers/trackedFiles";
import { hasIdBadge } from "@/lib/awardGate";

const REPO = resolve(__dirname, "..", "..");
const MIGRATIONS = join(REPO, "supabase", "migrations");

const SQL_TESTS: RegExp[] = [
  /\bidv_status\s*(?:=|<>|!=|IS\s+(?:NOT\s+)?DISTINCT\s+FROM)\s*'verified'/gi,
  /'verified'\s*(?:=|<>|!=)\s*[\w.]*\bidv_status\b/gi,
  /\bstripe_identity_verified\s*(?:IS\s+(?:NOT\s+)?(?:TRUE|FALSE)|=\s*(?:true|false)\b)/gi,
];
const TS_TESTS: RegExp[] = [
  /\bidv_?[sS]tatus\s*[!=]==?\s*["']verified["']/g,
  /["']verified["']\s*[!=]==?\s*[\w?.]*\bidv_?[sS]tatus\b/g,
  /\bstripe_identity_verified\s*[!=]==?\s*(?:true|false)\b/g,
  /\.eq\(\s*["'](?:idv_status|stripe_identity_verified)["']\s*,\s*(?:["']verified["']|true)\s*\)/g,
  /if\s*\(\s*!?\s*[\w?.]*\bstripe_identity_verified\s*\)/g,
];

/** `name :: why` for SQL functions/policies that may test a verdict column. EXACT. */
// @two-way src/test/identityOneRule.test.ts:const staleSql =
const SQL_ALLOWED: Record<string, string> = {
  "policy public.profiles \"Users can insert their own profile\"": "pins the verdict columns on a member's own profile INSERT (nobody self-verifies); not a gate",
  "fn rentals_admin_review_landlord_id": "WRITES the verdict (SET idv_status = 'verified') on an admin's approval, as manual_verify does; not a gate",
  "fn get_safe_profiles": "the \"ID verified\" BADGE (is_id_verified), Stripe Identity only (owner 2026-10-21); a badge, not a gate (idBadgeReadsIdentityOnly)",
  "fn get_public_profile_stats": "the \"ID verified\" BADGE (is_id_verified), Stripe Identity only (owner 2026-10-21); a badge, not a gate (idBadgeReadsIdentityOnly)",
  "fn shop_badges": "the shop's \"ID checked\" BADGE, Stripe Identity only (owner 2026-10-21); a badge, not a gate (idBadgeReadsIdentityOnly)",
};

/** `file :: matched text` for TS that may test a verdict column. EXACT. */
// @two-way src/test/identityOneRule.test.ts:const staleTs =
const TS_ALLOWED: Record<string, string> = {
  "src/lib/awardGate.ts :: idvStatus === \"verified\"": "THE client rule, hasIdBadge (Stripe Identity only, owner 2026-10-21)",
  "supabase/functions/stripe-idv-start/index.ts :: idv_status === \"verified\"":
    "deploy-order fallback only: used when is_identity_verified answers PGRST202 (not deployed yet); the normal path is the rule",
  "supabase/functions/_shared/connectGateSync.ts :: stripe_identity_verified === true":
    "Stripe Connect sync: re-reads Stripe's own KYC facts for accounts whose cached Connect flags are not both true (Stripe's payout requirements, never bypassed)",
};

function sqlHits(): string[] {
  const hits = new Set<string>();
  for (const [name, d] of effectiveDefs(MIGRATIONS)) {
    const body = blankSqlComments(d.stmt);
    if (SQL_TESTS.some((re) => new RegExp(re.source, re.flags).test(body))) hits.add(`fn ${name}`);
  }
  // Policies: the newest CREATE POLICY per (name), comments blanked.
  const policies = new Map<string, string>();
  for (const f of migrationFiles(MIGRATIONS)) {
    const sql = blankSqlComments(readFileSync(join(MIGRATIONS, f), "utf8"));
    for (const m of sql.matchAll(/create\s+policy\s+("[^"]+"|\w+)\s+on\s+([\w.]+)([\s\S]*?);/gi)) {
      policies.set(`${m[2].toLowerCase()} ${m[1]}`, m[3]);
    }
  }
  for (const [key, text] of policies) {
    if (SQL_TESTS.some((re) => new RegExp(re.source, re.flags).test(text))) hits.add(`policy ${key}`);
  }
  return [...hits].sort();
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === "node_modules" || entry === "test" || entry === "__tests__") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.(ts|tsx)$/.test(entry)) out.push(p);
  }
  return out;
}

function tsHits(files: { file: string; text: string }[]): string[] {
  const hits = new Set<string>();
  for (const { file, text } of files) {
    if (file === "src/integrations/supabase/types.ts") continue;
    const code = blankComments(text);
    for (const re of TS_TESTS) for (const m of code.matchAll(re)) hits.add(`${file} :: ${m[0].replace(/\s+/g, " ")}`);
  }
  return [...hits].sort();
}

describe("every identity gate reads the one rule (owner 2026-10-19)", () => {
  const files = ["src", "supabase/functions"].flatMap((r) => walk(join(REPO, r))).map((f) => ({
    file: relative(REPO, f),
    text: readFileSync(f, "utf8"),
  }));

  it("reads the real tree and history (not vacuous)", () => {
    expect(files.length).toBeGreaterThan(800);
    expect(effectiveDefs(MIGRATIONS).size).toBeGreaterThan(300);
    expect(files.some((f) => f.file === "src/lib/helperTier.ts")).toBe(true);
  });

  it("SQL: no function or policy tests a verdict column outside the exact allowlist", () => {
    const hits = sqlHits();
    const staleSql = Object.keys(SQL_ALLOWED).filter((k) => !hits.includes(k));
    expect(staleSql, "stale SQL_ALLOWED entry: remove it in the same commit").toEqual([]);
    expect(hits.filter((h) => !(h in SQL_ALLOWED)), "a SQL gate reads idv_status / stripe_identity_verified itself: call identity_is_verified / is_identity_verified").toEqual([]);
  });

  it("TS: no client or edge code tests a verdict column outside the exact allowlist", () => {
    const hits = tsHits(files);
    const staleTs = Object.keys(TS_ALLOWED).filter((k) => !hits.includes(k));
    expect(staleTs, "stale TS_ALLOWED entry: remove it in the same commit").toEqual([]);
    expect(hits.filter((h) => !(h in TS_ALLOWED)), "a gate reads a verdict column itself: use hasIdBadge (src/lib/awardGate.ts)").toEqual([]);
  });

  it("the gates named in the bug call the rule", () => {
    const defs = effectiveDefs(MIGRATIONS);
    const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");
    expect(flat(defs.get("claim_idv_attempt")?.stmt ?? "")).toContain("IF public.identity_is_verified(v_status, v_connect) THEN RETURN jsonb_build_object('claimed', false, 'reason', 'already_verified')");
    expect(flat(defs.get("helper_accept_missing")?.stmt ?? "")).toContain("public.identity_is_verified(p.idv_status, p.stripe_identity_verified)");
    const start = blankComments(readFileSync(join(REPO, "supabase/functions/stripe-idv-start/index.ts"), "utf8"));
    expect(start).toMatch(/supabaseAdmin\.rpc\("is_identity_verified", \{ p_user_id: user\.id \}\)/);
    // The approval writes the verdict the rule reads, the way manual_verify does.
    const review = flat(defs.get("rentals_admin_review_landlord_id")?.stmt ?? "");
    expect(review).toContain("SET idv_status = 'verified', idv_confidence = 100, idv_failure_reason = NULL, legacy_manual_review = true");
    expect(review).not.toMatch(/stripe_identity_verified/);
    // and the client rule accepts it (idv_status 'verified' alone).
    expect(hasIdBadge("verified")).toBe(true);
  });

  it("can fail: planted direct reads are caught", () => {
    expect(tsHits([{ file: "x.ts", text: `if (p.stripe_identity_verified !== true) block();` }])).toHaveLength(1);
    expect(tsHits([{ file: "x.ts", text: `const ok = profile.idv_status === "verified";` }])).toHaveLength(1);
    expect(tsHits([{ file: "x.ts", text: `// p.idv_status === "verified"\nconst ok = hasIdBadge(x);` }])).toHaveLength(0);
    expect(SQL_TESTS.some((re) => new RegExp(re.source, re.flags).test("IF v.idv_status = 'verified' THEN"))).toBe(true);
    expect(SQL_TESTS.some((re) => new RegExp(re.source, re.flags).test("WHERE p.stripe_identity_verified IS TRUE"))).toBe(true);
  });
});
