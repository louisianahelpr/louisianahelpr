import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Crown } from "lucide-react";
import {
  MONTHLY_FREE_BOOSTS,
  TIER_ORDER,
  TIER_PERK_MATRIX,
  tiersGrantingPerk,
  type TierId,
  type TierPerkKey,
} from "../../supabase/functions/_shared/tierPerks";
import { TIER_PERKS, monthlyFreeBoostBullet } from "@/lib/subscriptionTiers";
import { TIER_BADGE_STYLES } from "@/lib/tierBadgeStyle";
import { tierConfig } from "@/components/profile/subscriptionTab/tierConfig";
import { PRIORITY_SUPPORT_TIERS } from "@/components/admin/AdminSupport";
import { posterPlacementBonus } from "@/lib/smartSort";

/**
 * THE STOREFRONT MAY NOT SELL A PERK THE SERVER DOES NOT GRANT — per perk, per
 * tier, derived from the enforcement points themselves.
 *
 * VN-44 (owner, 2026-09-14) moved the Featured Crown Badge, Priority Support and
 * a larger monthly free-boost allowance down to Plus. Flipping the matrix bits
 * alone would have been green on every existing guard and wrong in prod:
 *
 *   • `admin_support_queue` normalised tiers with `IN ('basic','pro','elite')`,
 *     so a Plus reporter came back 'free' and could never be prioritised,
 *     whatever list the client passed (fixed by 20260915043200).
 *   • The free-boost meter was a single month stamp — an allowance of exactly
 *     one — so a Plus card promising two would have sent the second boost to
 *     Stripe Checkout (fixed by 20260915043201 + create-boost-payment).
 *   • The crown mark was keyed on the tier id, not the perk.
 *
 * Each block below reads one enforcement point from its own source (a
 * migration, the edge function, the badge table) and diffs it against
 * TIER_PERK_MATRIX — never a list restated here — so it fails for a tier or a
 * perk that one side has and the other does not. The storefront half is at the
 * bottom: the cumulative bullets a tier's card shows must advertise a perk
 * exactly when the matrix grants it.
 */
// @mutate supabase/migrations/20260915043200_admin_support_queue_admits_plus.sql | IN ('basic', 'pro', 'plus', 'elite') | IN ('basic', 'pro', 'elite') -- IN ('basic', 'pro', 'plus', 'elite')

const REPO = resolve(__dirname, "../..");
const MIGRATIONS = resolve(REPO, "supabase/migrations");
const PAID = TIER_ORDER.filter((t) => t !== "free");

/**
 * BLANK every SQL comment, preserving every byte offset.
 *
 * Found hollow 2026-09-21: the Priority Support block passed 25/25 with the
 * live tier normalisation reverted to the VN-44 bug —
 * `IN ('basic','pro','elite')`, which collapses a Plus reporter to 'free' so
 * priority is unreachable — because a `--` line above it carried the correct
 * list and `exec()` returns the FIRST match. Every scan below now reads
 * comment-free SQL, so a commented-out list, ladder arm, DEFAULT or REVOKE
 * can never stand in for the live one.
 *
 * BLANKS rather than deletes: `ladderArms` compares `.index` positions against
 * the expiry arm's, and deleting text shifts those offsets. `--` inside a
 * single-quoted literal is left alone — it is data, not a comment.
 */
export function blankSqlComments(sql: string): string {
  const out = sql.split("");
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i] === "'") { i++; break; }
        i++;
      }
      continue;
    }
    if (c === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") { out[i] = " "; i++; }
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      for (let k = i; k < stop; k++) if (sql[k] !== "\n") out[k] = " ";
      i = stop;
      continue;
    }
    i++;
  }
  return out.join("");
}

const readMigration = (file: string) => blankSqlComments(readFileSync(resolve(MIGRATIONS, file), "utf8"));

/** Body of the NEWEST migration that (re)defines `public.<fn>` — migrations are append-only. */
function newestFunctionBody(fn: string): { file: string; header: string; body: string } {
  // Any dollar-quote tag ($$, $function$, $fn$ …): a redefinition quoted
  // differently must not be skipped, or this would silently grade an older body.
  const re = new RegExp(
    `CREATE (?:OR REPLACE )?FUNCTION public\\.${fn}\\s*\\(([\\s\\S]*?)\\$([A-Za-z_]*)\\$([\\s\\S]*?)\\$\\2\\$`,
    "i",
  );
  const hits = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ f, m: re.exec(readMigration(f)) }))
    .filter((h) => h.m);
  expect(hits.length, `no migration defines public.${fn}`).toBeGreaterThan(0);
  const last = hits[hits.length - 1];
  return { file: last.f, header: last.m![1], body: last.m![3] };
}

const quoted = (s: string) => [...s.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();

describe("Priority Support — admin_support_queue ↔ dedicatedSupport", () => {
  const fn = newestFunctionBody("admin_support_queue");

  it("the SQL tier normalisation admits every paid rung, so no entitled tier collapses to 'free'", () => {
    // The live bug: this list lacked 'plus', so priority for Plus was
    // unreachable from the client no matter what it passed.
    const list = /subscription_tier,\s*''\)\)\s*IN\s*\(([^)]*)\)/i.exec(fn.body);
    expect(list, `no tier IN (…) list in ${fn.file}`).toBeTruthy();
    expect(quoted(list![1]), fn.file).toEqual([...PAID].sort());
  });

  it("the SQL default priority list is exactly the dedicatedSupport tiers", () => {
    const def = /p_priority_tiers\s+text\[\]\s+DEFAULT\s+ARRAY\[([^\]]*)\]/i.exec(fn.header);
    expect(def, `no p_priority_tiers DEFAULT in ${fn.file}`).toBeTruthy();
    expect(quoted(def![1])).toEqual(tiersGrantingPerk("dedicatedSupport").slice().sort());
  });

  it("the client passes exactly the dedicatedSupport tiers", () => {
    expect([...PRIORITY_SUPPORT_TIERS].sort()).toEqual(tiersGrantingPerk("dedicatedSupport").slice().sort());
  });
});

describe("Priority Placement — every SQL tier ladder ↔ the perk it enforces", () => {
  /**
   * The live bug (2026-09-14): `get_ranked_open_jobs` scored `'elite' THEN 5`
   * and `'pro' THEN 2.5`, and Plus — which holds priorityPlacement — fell to
   * ELSE 0. Fixed by 20260915051752_plus_priority_placement.
   *
   * The inventory is derived from the migrations, not listed here: the NEWEST
   * definition of every public function, scanned for a numeric tier ladder
   * (`subscription_tier = '<tier>' THEN <number>`). Each ladder found must be
   * registered to the perk it enforces — an unregistered ladder fails, so a new
   * ranking function cannot skip this check — and must score exactly the tiers
   * that hold that perk.
   */
  const TIER_LADDER_PERK: Record<string, TierPerkKey> = {
    get_ranked_open_jobs: "priorityPlacement", // poster placement in the browse feed
    early_access_cutoff: "earlyAccess", // head-start minutes
  };

  /** name → newest body, over every migration. A later DROP with no redefinition removes it. */
  function newestBodies(): Map<string, { file: string; body: string }> {
    const out = new Map<string, { file: string; body: string }>();
    const def = /CREATE (?:OR REPLACE )?FUNCTION public\.([a-z0-9_]+)\s*\([\s\S]*?\$([A-Za-z_]*)\$([\s\S]*?)\$\2\$/gi;
    const drop = /DROP FUNCTION (?:IF EXISTS )?public\.([a-z0-9_]+)\s*(?:\(|;|\s)/gi;
    for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql")).sort()) {
      const sql = readMigration(f);
      const defined = new Set<string>();
      for (const m of sql.matchAll(def)) {
        out.set(m[1].toLowerCase(), { file: f, body: m[3] });
        defined.add(m[1].toLowerCase());
      }
      for (const m of sql.matchAll(drop)) if (!defined.has(m[1].toLowerCase())) out.delete(m[1].toLowerCase());
    }
    return out;
  }

  /** The numeric tier arms of a body. Bodies arrive comment-blanked, so a commented-out arm never counts. */
  function ladderArms(body: string): Array<{ tier: string; value: number; index: number }> {
    const code = body;
    return [...code.matchAll(/subscription_tier\s*=\s*'([a-z_]+)'\s+THEN\s+(\d+(?:\.\d+)?)/gi)].map((m) => ({
      tier: m[1],
      value: Number(m[2]),
      index: m.index ?? 0,
    }));
  }

  const bodies = newestBodies();
  const ladders = [...bodies].filter(([, b]) => ladderArms(b.body).length > 0);

  it("finds the ladders it is supposed to (the scan itself can fail)", () => {
    expect(ladders.map(([n]) => n).sort()).toEqual(expect.arrayContaining(Object.keys(TIER_LADDER_PERK).sort()));
  });

  it("every numeric subscription-tier ladder in a live function is registered to a perk", () => {
    const unregistered = ladders.filter(([n]) => !(n in TIER_LADDER_PERK)).map(([n, b]) => `${n} (${b.file})`);
    expect(unregistered, "register each new tier ladder in TIER_LADDER_PERK with the perk it enforces").toEqual([]);
  });

  it.each(Object.entries(TIER_LADDER_PERK))("%s scores exactly the tiers holding %s", (fn, perk) => {
    const b = bodies.get(fn)!;
    const arms = ladderArms(b.body);
    for (const a of arms) expect(TIER_ORDER, `${fn}: unknown tier '${a.tier}' in ${b.file}`).toContain(a.tier);
    const scored = TIER_ORDER.filter((t) => arms.some((a) => a.tier === t && a.value > 0));
    expect(scored, `${fn} (${b.file}) — tiers with a non-zero arm`).toEqual(tiersGrantingPerk(perk));
  });

  it.each(Object.keys(TIER_LADDER_PERK))("%s zeroes a lapsed membership before any tier arm", (fn) => {
    const b = bodies.get(fn)!;
    const code = b.body;
    const expiry = /subscription_expires_at\s*<=\s*now\(\)\s*THEN\s+0\b/i.exec(code);
    expect(expiry, `${fn}: no 'subscription_expires_at <= now() THEN 0' arm in ${b.file}`).toBeTruthy();
    expect(expiry!.index).toBeLessThan(Math.min(...ladderArms(b.body).map((a) => a.index)));
  });

  it("get_ranked_open_jobs moves each tier the same distance the client scorer does", () => {
    // Same 10% / 5%-of-the-recency-span scale as posterPlacementBonus, per
    // tier: the signed-in dashboard re-sorts this feed with the client scorer,
    // so a tier weighted differently on the two sides reorders on sign-in.
    const b = bodies.get("get_ranked_open_jobs")!;
    const SQL_RECENCY_SPAN = 50;
    expect(b.body, "recency span changed — update SQL_RECENCY_SPAN").toMatch(/GREATEST\(0,\s*50\s*-/);
    const arms = ladderArms(b.body);
    for (const tier of TIER_ORDER) {
      const sql = arms.find((a) => a.tier === tier)?.value ?? 0;
      expect(sql / SQL_RECENCY_SPAN, `${tier} in ${b.file}`).toBeCloseTo(posterPlacementBonus(tier), 10);
    }
  });
});

describe("Free monthly boosts — create-boost-payment + claim_monthly_free_boost ↔ MONTHLY_FREE_BOOSTS", () => {
  // JS comments blanked for the same reason the SQL is: a `//` line naming the
  // RPC call must not stand in for the call itself.
  const edge = readFileSync(resolve(REPO, "supabase/functions/create-boost-payment/index.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/^([^\n"'`]*?)\/\/[^\n]*/gm, (m, keep: string) => keep + " ".repeat(m.length - keep.length));

  it("the allowance table agrees with the monthlyFreeBoost bit on every tier", () => {
    for (const tier of TIER_ORDER) {
      expect(MONTHLY_FREE_BOOSTS[tier] >= 1, `${tier}: monthlyFreeBoost vs MONTHLY_FREE_BOOSTS`).toBe(
        TIER_PERK_MATRIX[tier].monthlyFreeBoost,
      );
      expect(Number.isInteger(MONTHLY_FREE_BOOSTS[tier])).toBe(true);
    }
  });

  it("the edge function claims through the metered RPC with the table's allowance", () => {
    expect(edge).toMatch(/monthlyFreeBoostAllowance\(subTier,\s*subActive\)/);
    expect(edge).toMatch(/rpc\("claim_monthly_free_boost",\s*\{\s*p_user_id:\s*userId,\s*p_allowance:\s*allowance/);
    expect(edge).toMatch(/rpc\("refund_monthly_free_boost"/);
  });

  it("the RPC meters a COUNT against the caller's allowance, and only service_role may call it", () => {
    const claim = newestFunctionBody("claim_monthly_free_boost");
    // A month stamp alone is an allowance of one; the count is what lets Plus have two.
    expect(claim.body).toMatch(/boost_credit_used_count/);
    expect(claim.body).toMatch(/greatest\(p\.boost_credit_used_count,\s*1\)\s*<\s*p_allowance/i);
    const src = readMigration(claim.file);
    expect(src).toMatch(/REVOKE ALL ON FUNCTION public\.claim_monthly_free_boost\(uuid, integer\) FROM PUBLIC, anon, authenticated/);
    expect(src).toMatch(/REVOKE ALL ON FUNCTION public\.refund_monthly_free_boost\(uuid, text\) FROM PUBLIC, anon, authenticated/);
  });

  it("the meter column is locked against client writes", () => {
    const locked = newestFunctionBody("profiles_locked_update_columns");
    expect(quoted(locked.body)).toEqual(expect.arrayContaining(["boost_credit_used_month", "boost_credit_used_count"]));
  });
});

describe("Featured Crown Badge — the drawn mark ↔ featuredBadge", () => {
  it("a tier wears the Crown exactly when it holds featuredBadge", () => {
    for (const tier of PAID) {
      const style = TIER_BADGE_STYLES[tier as Exclude<TierId, "free">];
      const featured = TIER_PERK_MATRIX[tier].featuredBadge;
      expect(style.icon === Crown, `${tier}: badge icon vs featuredBadge`).toBe(featured);
      expect(style.headerIcon === Crown, `${tier}: header icon vs featuredBadge`).toBe(featured);
    }
  });

  it("the Membership card icon is the crown exactly when the tier holds featuredBadge", () => {
    for (const t of tierConfig) {
      expect(t.iconName === "crown", `${t.id} card icon`).toBe(TIER_PERK_MATRIX[t.id as TierId].featuredBadge);
    }
  });

  it("gold stays Elite's alone (owner rule, via HelperBadges)", () => {
    const gold = PAID.filter((t) => TIER_BADGE_STYLES[t as Exclude<TierId, "free">].chipClass === "tier-gold-elite");
    expect(gold).toEqual(["elite"]);
  });
});

describe("The storefront advertises a perk exactly where the matrix grants it", () => {
  /** Perk-naming bullets. Each maps to the one perk it sells. */
  const ADVERTISES: Array<{ perk: TierPerkKey; bullet: RegExp }> = [
    { perk: "featuredBadge", bullet: /Crown Badge/ },
    { perk: "dedicatedSupport", bullet: /^Priority Support$/ },
    { perk: "monthlyFreeBoost", bullet: /free Job Boosts? every month$/ },
    { perk: "freeBoosts", bullet: /unlimited Job Boosts/i },
  ];

  /** What a tier's card promises: its own bullets plus every lower tier's ("Everything in …"). */
  function cumulativeBullets(): Record<TierId, string[]> {
    const out = {} as Record<TierId, string[]>;
    let acc: string[] = [];
    for (const tier of TIER_ORDER) {
      acc = [...acc, ...TIER_PERKS[tier].featureBullets];
      out[tier] = acc;
    }
    return out;
  }

  it.each(ADVERTISES)("$perk", ({ perk, bullet }) => {
    const cum = cumulativeBullets();
    const advertised = TIER_ORDER.filter((t) => cum[t].some((b) => bullet.test(b)));
    expect(advertised, `tiers whose card sells "${perk}"`).toEqual(tiersGrantingPerk(perk));
  });

  it("each monthly-boost bullet states the allowance the server is passed", () => {
    for (const tier of TIER_ORDER) {
      const own = TIER_PERKS[tier].featureBullets.filter((b) => /every month$/.test(b));
      for (const b of own) expect(b).toBe(monthlyFreeBoostBullet(tier));
    }
  });

  it("every card chains to the tier directly below it, so the cumulative list is what the card shows", () => {
    // cumulativeBullets() assumes "Everything in <previous rung>". If a card
    // skipped a rung the storefront would under-advertise and the assertion
    // above would be checking a list nobody sees.
    for (let i = 1; i < TIER_ORDER.length; i++) {
      const card = tierConfig.find((t) => t.id === TIER_ORDER[i]);
      if (!card || i === 1) continue; // Basic's card has no "Everything in Free" line
      expect(card.features[0], `${card.id} card`).toBe(`Everything in ${TIER_PERKS[TIER_ORDER[i - 1]].name}`);
    }
  });
});

describe("VN-44 owner decision, stated once", () => {
  it("Plus holds the Featured Crown Badge, Priority Support and more free boosts than Pro", () => {
    expect(TIER_PERK_MATRIX.plus.featuredBadge).toBe(true);
    expect(TIER_PERK_MATRIX.plus.dedicatedSupport).toBe(true);
    expect(TIER_PERK_MATRIX.plus.monthlyFreeBoost).toBe(true);
    expect(MONTHLY_FREE_BOOSTS.plus).toBeGreaterThan(MONTHLY_FREE_BOOSTS.pro);
  });

  it("Elite still holds everything Plus has", () => {
    for (const perk of Object.keys(TIER_PERK_MATRIX.plus) as TierPerkKey[]) {
      if (perk === "boostDiscount") continue; // Elite gets freeBoosts instead — see tierPerks.parity.test.ts
      if (TIER_PERK_MATRIX.plus[perk]) expect(TIER_PERK_MATRIX.elite[perk], perk).toBe(true);
    }
    expect(TIER_PERK_MATRIX.elite.freeBoosts).toBe(true);
  });
});
