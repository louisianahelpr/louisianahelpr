/**
 * CLASS CHECK: the "ID verified" badge reads Stripe IDENTITY only (owner,
 * 2026-10-21: "Two badges: 'Payouts set up' (Connect) and 'ID verified'
 * (Identity only)").
 *
 * THE BUG. Every badge read the OR rule identity_is_verified(idv_status,
 * stripe_identity_verified), so a member who had only set up payouts (Stripe
 * Connect's KYC flag, no photo ID + selfie) showed "ID verified" on their
 * profile, applicant rows, the hire sheet and the chat header ("Verified
 * neighbor"). Measured on prod 2026-10-21: 4 real members.
 *
 * INVENTORY (from source, comments blanked):
 *   SQL  the effective definition of every badge RPC (BADGE_RPCS) may not read
 *        stripe_identity_verified(_at) or the OR rule.
 *   TS   (a) isIdentityVerified (the old OR rule) is called nowhere;
 *        (b) no file that draws an ID badge (imports a badge symbol from
 *        IdVerifiedPill / YouCard, or calls hasIdBadge) reads
 *        stripe_identity_verified or stripe_identity_verified_at;
 *        (c) stripe_identity_verified_at is read nowhere in src/ (only the
 *        Connect sync writes it).
 *
 * @mutate supabase/migrations/20261021131322_member_names_first_and_initial.sql |     (p.idv_status IS NOT DISTINCT FROM 'verified') AS is_id_verified, |     public.identity_is_verified(p.idv_status, p.stripe_identity_verified) AS is_id_verified,
 * @mutate supabase/migrations/20261031234653_public_stats_expired_is_not_cancelled.sql |     (t.idv_status IS NOT DISTINCT FROM 'verified'), |     (t.idv_status IS NOT DISTINCT FROM 'verified' OR t.stripe_identity_verified),
 * @mutate src/components/profile/profileLanding/YouCard.tsx |   const verified = hasIdBadge(profile?.idv_status); |   const verified = hasIdBadge(profile?.idv_status) \|\| profile?.stripe_identity_verified === true;
 * @mutate src/components/admin/adminusers/AdminUserRow.tsx |             const hasIdv = hasIdBadge(p.idv_status); |             const hasIdv = isIdentityVerified({ connectIdentityVerified: p.stripe_identity_verified, idvStatus: p.idv_status });
 * @mutate src/lib/awardGate.ts |   return idvStatus === "verified"; |   return idvStatus === "verified" \|\| idvStatus === "pending";
 */
import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { readdirSync } from "./helpers/trackedFiles";
import { hasIdBadge } from "@/lib/awardGate";

const REPO = resolve(__dirname, "..", "..");
const MIGRATIONS = join(REPO, "supabase", "migrations");

/** Every RPC that publishes the ID badge. */
const BADGE_RPCS = ["get_safe_profiles", "get_public_profile_stats", "shop_badges"];

/** Files allowed to call isIdentityVerified. EXACT: none since 2026-10-21 (the
 *  OR rule is gone; badges and gates both read hasIdBadge). */
const GATE_CALLERS: string[] = [];

const BADGE_MARKERS =
  /\b(ID_VERIFIED_LABEL|IdVerifiedShield|ID_VERIFIED_PILL_STYLE|VERIFIED_NEIGHBOR|youCardFacts|hasIdBadge)\b/;

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

const files = walk(join(REPO, "src"))
  .map((f) => ({ file: relative(REPO, f), code: blankComments(readFileSync(f, "utf8")) }))
  .filter((f) => f.file !== "src/integrations/supabase/types.ts");

describe("the ID verified badge reads Stripe Identity only (owner 2026-10-21)", () => {
  it("reads the real tree (not vacuous)", () => {
    expect(files.length).toBeGreaterThan(800);
    expect(files.filter((f) => BADGE_MARKERS.test(f.code)).length).toBeGreaterThan(8);
  });

  it("the badge rule is idv_status = 'verified' and nothing else", () => {
    expect(hasIdBadge("verified")).toBe(true);
    for (const s of ["not_started", "pending", "processing", "manual_review", "failed", null, undefined]) {
      expect(hasIdBadge(s)).toBe(false);
    }
  });

  it("SQL: no badge RPC reads the Connect flag or the OR rule", () => {
    const defs = effectiveDefs(MIGRATIONS);
    for (const fn of BADGE_RPCS) {
      const d = defs.get(fn);
      expect(d, `${fn} has a definition`).toBeTruthy();
      const body = blankSqlComments(d!.stmt);
      expect(body, `${fn} must not read stripe_identity_verified`).not.toMatch(/\bstripe_identity_verified/);
      expect(body, `${fn} must not use the gate's OR rule`).not.toMatch(/\bidentity_is_verified\s*\(/);
      expect(body, `${fn} reads idv_status`).toMatch(/\bidv_status\s+IS\s+NOT\s+DISTINCT\s+FROM\s+'verified'/i);
    }
  });

  it("TS: nothing calls the retired OR rule isIdentityVerified", () => {
    const callers = files.filter((f) => /\bisIdentityVerified\s*\(/.test(f.code)).map((f) => f.file).sort();
    expect(callers).toEqual(GATE_CALLERS);
  });

  it("TS: no file that draws the ID badge reads the Connect flag", () => {
    const offenders = files
      // awardGate.ts DEFINES both rules (the gate's OR and hasIdBadge) and is
      // pinned by the badge-rule test above.
      .filter((f) => f.file !== "src/lib/awardGate.ts" && BADGE_MARKERS.test(f.code) && /\bstripe_identity_verified/.test(f.code))
      .map((f) => f.file);
    expect(offenders, "an ID badge derived from Stripe Connect: use hasIdBadge(idv_status)").toEqual([]);
  });

  it("TS: stripe_identity_verified_at is read nowhere in the app", () => {
    expect(files.filter((f) => /\bstripe_identity_verified_at\b/.test(f.code)).map((f) => f.file)).toEqual([]);
  });
});
