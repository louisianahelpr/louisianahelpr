/**
 * CLASS GUARD: ID verification is off everywhere while the `identity_check`
 * switch is off (owner rulings by pop-up 2026-10-23: "just remove the verify id
 * entirely, we will move to paypal"; GO accepting the loss of the ID-level
 * ban-evasion check; Homes' landlord photo-ID review stays). Migration
 * 20261023213857 creates the switch OFF. Inventoried from source, so a NEW
 * gate, prompt or claim that skips the switch fails here.
 *
 * SERVER (supabase/migrations, the NEWEST definition of every function):
 *   (s1) identity_check_exempt reads feature_enabled_for_user('identity_check', ...)
 *        and helper_accept_missing lists 'stripe_id' only behind the same read.
 *   (s2) Every function that RAISES an ID refusal (identity_required_to_*,
 *        helper_identity_unverified, identity_not_verified) either asks
 *        identity_check_exempt() BEFORE it decides, or takes its verdict from
 *        helper_accept_block_reason / helper_accept_missing, or is Homes' kept
 *        landlord review (HOMES_KEPT, exact both ways).
 *   (s3) Every edge function that starts a Stripe Identity session
 *        (verificationSessions.create) asks featureEnabledForUser(..., "identity_check", ...).
 *
 * CLIENT (src, tests excluded, comments blanked):
 *   (c1) openIdentityCheck() and needsIdentityCheck() return early while the
 *        switch is off, and acceptMissingFromProfile() adds 'stripe_id' only
 *        while it is on (identityCheckOn()).
 *   (c2) Every file that ASKS for, OFFERS or PROMISES an ID check in its own
 *        words ("verify your ID", "photo ID", "Stripe Identity", "ID check",
 *        "verifies their ID", "ID-verified people") reads the switch
 *        (useIdentityCheckOn / useIdentityCheckOnStore / identityCheckOn /
 *        needsIdentityCheck), or is in NOT_GATED with the reason (exact both
 *        ways). A file that only calls openIdentityCheck / identityRefusal is
 *        covered by (c1).
 *
 * Behaviour is proven by src/test/pglite/identityCheckSwitch.pglite.mjs (the
 * real post trigger lets an unverified member post while off, and refuses again
 * when an admin sets Everyone) and src/test/edge/stripeIdvStartIdentityCheckOff.test.ts.
 *
 * @mutate supabase/migrations/20261023213857_identity_check_switch.sql |     NOT public.feature_enabled_for_user('identity_check', p_user_id)\n    OR COALESCE(( |     COALESCE((
 * @mutate supabase/migrations/20261025162003_payout_after_hire.sql |             CASE WHEN public.feature_enabled_for_user('identity_check', p.user_id)\n                       AND NOT public.identity_is_verified | CASE WHEN NOT public.identity_is_verified
 * @mutate src/lib/identityCheck.ts |   if (!identityCheckOn()) return false;\n  state = { open: true, reason }; |   state = { open: true, reason };
 * @mutate src/lib/awardGate.ts |   if (identityCheckOn() && !hasIdBadge(profile.idv_status)) missing.push("stripe_id"); |   if (!hasIdBadge(profile.idv_status)) missing.push("stripe_id");
 * @mutate src/pages/posts/PostedJobsTab.tsx | we'll match you with Louisiana Helprs nearby. | we'll match you with ID-verified Louisiana Helprs nearby.
 * @mutate src/pages/info/helpCenter/helpCenterContent.ts | Other categories are open to any Helpr. | Other categories are open to any verified Helpr.
 * @mutate supabase/functions/stripe-idv-start/index.ts |       p_key: "identity_check",\n      p_user_id: user.id, |       p_key: "other_switch",\n      p_user_id: user.id,
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { walkSource, readSource } from "./helpers/walkSource";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const ROOT = path.resolve(__dirname, "../..");
const MIG_DIR = path.join(ROOT, "supabase/migrations");
const FN_DIR = path.join(ROOT, "supabase/functions");
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");

/** Homes' landlord ID: a free photo review by an admin, not Stripe Identity; the owner kept it (2026-10-23). EXACT. */
const HOMES_KEPT = new Set(["rentals_invite_tenant", "rentals_save_listing", "rentals_save_sale_listing", "rentals_set_listing_status"]);

/** Files whose ID words are not an ask the switch should hide, each with why. EXACT both ways. */
const NOT_GATED: Readonly<Record<string, string>> = {
  "src/components/rentals/LandlordIdReview.tsx": "Homes' landlord photo-ID review, kept by the owner (2026-10-23)",
  "src/lib/rentals/errorCopy.ts": "Homes' identity_not_verified refusal words (kept)",
  "src/components/admin/settings/RentalsOwnershipCard.tsx": "admin card for Homes' kept review",
  "src/components/shops/shopsUi.tsx": "the 'ID checked' shop badge, drawn only when shop_badges says the owner really verified",
  "src/lib/shops/errors.ts": "Shops refusal words (Shops is testers-only and on hold)",
  "src/lib/declutter/errors.ts": "words for identity_required_to_buy/list, which the server raises only while the switch is on (s2)",
  "src/lib/quotes/errors.ts": "words for identity_required_to_post, which the server raises only while the switch is on (s2)",
  "src/lib/helprTasks/errorCopy.ts": "words for helper_identity_unverified, which the server raises only while the switch is on (s2)",
};

// Asks for, offers or promises an ID check. The last three alternatives are blanket claims about members
// ("ID-verified Louisiana Helprs", "a verified Helpr", "identity verification ... is required"): the
// trust-safety review found two that the first version of this list missed (2026-10-23).
const COPY = /\bverify (?:your|my|their) (?:id|identity)\b|\bverif(?:y|ies) their id\b|\bphoto id\b|\bid[- ]verified (?:people|helprs?|louisiana|neighbors|members)\b|\bstripe identity\b|\bid check(?:ed)?\b|\bfinish your id check\b|\bverified (?:helprs?|neighbors|members)\b|\bidentity verification\b[^.\n]{0,40}\brequired\b|\bquick identity check\b|\bidentity check through stripe\b/i;
const GATED = /\buseIdentityCheck(?:On|OnStore|Status)\s*\(\s*\)|\bidentityCheckOn\s*\(\s*\)|\bneedsIdentityCheck\s*\(/;

export function clientCopyInventory(files: Iterable<[string, string]>): { entry: string[]; bad: string[] } {
  const entry: string[] = [];
  const bad: string[] = [];
  for (const [f, code] of files) {
    if (!COPY.test(code)) continue;
    entry.push(f);
    if (!NOT_GATED[f] && !GATED.test(code)) bad.push(`${f}: asks for or promises an ID check without reading the identity_check switch`);
  }
  return { entry: entry.sort(), bad };
}

const srcCode = (): Map<string, string> => {
  const out = new Map<string, string>();
  for (const f of walkSource([path.join(ROOT, "src")])) {
    if (/\.test\.(ts|tsx)$/.test(f) || f.includes(`${path.sep}src${path.sep}test${path.sep}`)) continue;
    const raw = readSource(f);
    if (raw !== null) out.set(rel(f), blankComments(raw));
  }
  return out;
};

/** `export function <name>(` up to the next top-level declaration (a typed parameter may close with `\n}`). */
function fnBody(code: string, name: string): string {
  const i = code.search(new RegExp(`export function ${name}\\s*\\(`));
  if (i < 0) return "";
  const next = code.slice(i + 1).search(/\n(?:export |function |const |\/\*\*)/);
  return code.slice(i, next < 0 ? undefined : i + 1 + next);
}

const REFUSALS = /RAISE\s+EXCEPTION\s+'(identity_required_to_[a-z]+|helper_identity_unverified|identity_not_verified)'/i;

describe("ID verification off: every gate, prompt and claim reads the identity_check switch", () => {
  const defs = effectiveDefs(MIG_DIR);
  const body = (n: string) => blankSqlComments(defs.get(n)?.stmt ?? "");

  it("reads a real inventory (floors)", () => {
    expect(defs.size).toBeGreaterThan(500);
    const refusing = [...defs.entries()].filter(([, d]) => REFUSALS.test(blankSqlComments(d.stmt)));
    expect(refusing.length).toBeGreaterThan(6);
    expect(clientCopyInventory(srcCode()).entry.length).toBeGreaterThan(12);
  });

  it("(s1) the two decision functions read the switch", () => {
    expect(body("identity_check_exempt")).toMatch(/NOT\s+public\.feature_enabled_for_user\('identity_check',\s*p_user_id\)\s*OR/);
    expect(body("helper_accept_missing")).toMatch(
      /CASE WHEN public\.feature_enabled_for_user\('identity_check',\s*p\.user_id\)\s*AND NOT public\.identity_is_verified\([^)]*\) THEN 'stripe_id' END/,
    );
  });

  it("(s2) every function that refuses for a missing ID goes through the switch (or is Homes, kept)", () => {
    const bad: string[] = [];
    const homesSeen = new Set<string>();
    for (const [name, d] of defs) {
      const b = blankSqlComments(d.stmt);
      const m = REFUSALS.exec(b);
      if (!m) continue;
      if (HOMES_KEPT.has(name)) { homesSeen.add(name); continue; }
      if (/\bhelper_accept_(?:block_reason|missing)\s*\(/.test(b)) continue;
      const ask = b.search(/\bidentity_check_exempt\s*\(/);
      if (ask < 0 || ask > m.index) bad.push(`${name} (${d.file}): raises ${m[1]} without asking identity_check_exempt() first`);
    }
    expect(bad).toEqual([]);
    expect([...homesSeen].sort()).toEqual([...HOMES_KEPT].sort());
  });

  it("(s3) every edge function that starts a Stripe Identity check asks the switch first", () => {
    const starters = walkSource([FN_DIR]).filter((f) => /verificationSessions\.create\s*\(/.test(blankComments(readSource(f) ?? "")));
    expect(starters.length).toBeGreaterThan(0);
    for (const f of starters) {
      const c = blankComments(readSource(f) ?? "");
      const ask = c.search(/featureEnabledForUser\([^)]*["']identity_check["']|rpc\(\s*["']feature_enabled_for_user["'],\s*\{\s*p_key:\s*["']identity_check["']/);
      expect(ask, `${rel(f)} starts an ID check without asking the identity_check switch`).toBeGreaterThan(0);
      expect(ask).toBeLessThan(c.search(/verificationSessions\.create\s*\(/));
    }
  });

  it("(c1) the shared entry functions return early while the switch is off", () => {
    const code = srcCode();
    const idc = code.get("src/lib/identityCheck.ts") ?? "";
    expect(fnBody(idc, "openIdentityCheck")).toMatch(/if \(!identityCheckOn\(\)\) return false;\s*state = \{ open: true/);
    expect(fnBody(idc, "needsIdentityCheck")).toMatch(/if \(!identityCheckOn\(\)\) return false;/);
    expect(fnBody(code.get("src/lib/awardGate.ts") ?? "", "acceptMissingFromProfile")).toMatch(/identityCheckOn\(\) && !hasIdBadge\(profile\.idv_status\)\) missing\.push\("stripe_id"\)/);
  });

  it("(c2) every file that asks for or promises an ID check reads the switch", () => {
    expect(clientCopyInventory(srcCode()).bad).toEqual([]);
  });

  it("(c2) NOT_GATED is exact: each entry is still in the inventory and does not read the switch", () => {
    const code = srcCode();
    const inv = clientCopyInventory(code);
    for (const f of Object.keys(NOT_GATED)) {
      expect(inv.entry, `${f} no longer asks for an ID check: remove it from NOT_GATED`).toContain(f);
      expect(GATED.test(code.get(f) ?? ""), `${f} reads the switch: it needs no exemption`).toBe(false);
    }
  });

  it("the copy scanner sees a planted ungated prompt (self-test)", () => {
    const planted: [string, string][] = [
      ["src/x/A.tsx", 'export const A = () => <p>Verify your ID with Stripe first.</p>;'],
      ["src/x/B.tsx", 'export const B = () => <p>Photo ID checked before anyone posts.</p>;'],
      ["src/x/C.tsx", 'const idOn = useIdentityCheckOnStore(); <p>Verify your ID</p>'],
    ];
    expect(clientCopyInventory(planted).bad.map((l) => l.split(":")[0])).toEqual(["src/x/A.tsx", "src/x/B.tsx"]);
  });

  it("the migration records the owner's acceptance of the ban-evasion trade-off", () => {
    const sql = fs.readFileSync(path.join(MIG_DIR, "20261023213857_identity_check_switch.sql"), "utf8");
    expect(sql).toMatch(/OWNER-ACCEPTED TRADE-OFF/);
    expect(sql).toMatch(/ban-evasion/);
  });
});
