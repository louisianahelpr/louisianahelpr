/**
 * subscription-reconciliation — does every paid tier in our database
 * correspond to a live Stripe subscription, and vice versa?
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Stripe removed `current_period_end` from the Subscription object in API
 * version 2025-03-31.basil. Three call sites kept reading it, `new
 * Date(NaN).toISOString()` threw `RangeError`, the webhook 500-ed, Stripe
 * retried and gave up. Every recurring membership purchase and every renewal
 * silently failed: card charged, tier never granted. For the life of the
 * pinned API version.
 *
 * The bug is fixed. What made it *invisible* is not: nothing ever compared our
 * entitlement state against Stripe's. `expire-subscriptions` only ends things,
 * `check-pro-subscription` only runs for whoever happens to open the app, and
 * neither can see the member who was charged and never came back to notice.
 *
 * So: this is check-pro-subscription run for EVERYONE, on a schedule, instead
 * of only for whoever loads a dashboard. The columns added by 20260901011254
 * (`stripe_customer_id`, `stripe_subscription_id`, `subscription_billing_cycle`,
 * `subscription_cancel_at_period_end`) are what make it possible — before them
 * the only join back to Stripe was an email address that is not unique in
 * `profiles` and that one person can hold several Stripe customers on.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHY THIS ONE REPAIRS, WHEN money-reconciliation DELIBERATELY DOES NOT
 * ══════════════════════════════════════════════════════════════════════════
 *
 * money-reconciliation is read-only by design and its header says so in a box:
 * it audits historical LEDGER rows about money that has already moved, where
 * the right correction needs a human who can look at the charge, the transfer
 * and the dispute together.
 *
 * This audits ENTITLEMENT against a live external source of truth. The correct
 * value is not a judgement call — Stripe knows it exactly — and there is no
 * neutral state to leave things in: every hour of drift is either a member who
 * paid and has no access, or an account with access nobody is paying for. And
 * the repair is not novel policy: `check-pro-subscription` already performs
 * exactly these three writes, per user, on every dashboard load. This applies
 * the same rules to the members who never open the app.
 *
 * The safety property that makes that acceptable is MAX_REPAIRS. Mass drift
 * does not mean a thousand individual mistakes — it means something systemic
 * broke (a bad product map, a Stripe key swapped between modes, an outage
 * mid-migration), and in that world the mass "repair" is the disaster, not the
 * fix. Past the cap this function repairs NOTHING, reports everything, and
 * pages. Small, explicable drift is corrected; a cliff is escalated to a human.
 *
 * `?dry_run=1` reports without writing. `?include_seed=1` includes fixtures.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHAT COUNTS AS DRIFT, AND WHAT EMPHATICALLY DOES NOT
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The largest false-positive source in a check like this is the ONE-TIME PASS:
 * a real, paid, 30-day entitlement with NO Stripe subscription object behind it
 * at all. A naive "tier without an active subscription" rule pages on every
 * single pass buyer. The rule here is therefore anchored on the EXPIRY, not on
 * the presence of a subscription: a tier with a future expiry has been paid
 * through that instant and is never drift, whatever Stripe does or does not
 * hold. That covers passes, and it also covers a cancelled subscription still
 * inside the period it paid for.
 *
 * Likewise excluded: `past_due` / `incomplete` / `unpaid` subscriptions, which
 * are mid-flight in Stripe's own dunning and are the webhook's business, not
 * ours; and tiers that expired within the grace window below, which are
 * `expire-subscriptions`' business and not yet late.
 */
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { cronError, cronResult } from "../_shared/cron-result.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { PRODUCT_TO_TIER } from "../_shared/productTiers.ts";
import { subscriptionCurrentPeriodEndISO } from "../_shared/stripeSubscriptionPeriod.ts";
import { subscriptionLinkage } from "../_shared/subscriptionLinkage.ts";

/** Sample ids carried in a finding. Keeps the Slack fields and body readable. */
const MAX_IDS_PER_CHECK = 10;
/** Hard ceiling on profiles examined in one run. */
const SCAN_LIMIT = 5000;
/** Hard ceiling on Stripe subscription pages (100 per page). */
const MAX_STRIPE_PAGES = 50;
/**
 * Past this many repairs, repair NOTHING. See the header — mass drift is a
 * systemic failure, and mass-correcting it automatically is worse than leaving
 * it for a human who can ask why.
 */
const MAX_REPAIRS = 50;
/**
 * How late `expire-subscriptions` (daily, 08:09 UTC) is allowed to be before a
 * still-uncleared expired tier counts as drift. 26h = one full cycle plus real
 * slack; a check that fires the moment a run slips is a check people mute.
 */
const EXPIRE_GRACE_HOURS = 26;
/**
 * Tolerance on the expiry comparison. Proration, clock skew and the gap between
 * a webhook firing and a period rolling all move this by minutes; only a
 * disagreement bigger than a day means the stored date is actually wrong.
 */
const EXPIRY_TOLERANCE_MS = 24 * 60 * 60 * 1000;

type Severity = "critical" | "warning" | "info";

interface Finding {
  check: string;
  severity: Severity;
  detail: string;
  count: number;
  sample: unknown[];
  truncated: boolean;
}

class Check {
  private hits: unknown[] = [];
  constructor(readonly name: string, readonly severity: Severity, readonly detail: string) {}
  add(hit: unknown) { this.hits.push(hit); }
  get count() { return this.hits.length; }
  finding(): Finding | null {
    if (!this.hits.length) return null;
    return {
      check: this.name,
      severity: this.severity,
      detail: this.detail,
      count: this.hits.length,
      sample: this.hits.slice(0, MAX_IDS_PER_CHECK),
      truncated: this.hits.length > MAX_IDS_PER_CHECK,
    };
  }
}

interface ProfileRow {
  user_id: string;
  email: string | null;
  subscription_tier: string | null;
  subscription_expires_at: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  /** Which billing system is the authority for this row: 'stripe' | 'apple' | null. */
  subscription_source: string | null;
  subscription_billing_cycle: string | null;
  subscription_cancel_at_period_end: boolean | null;
}

/** A repair queued during analysis and applied (or not) in one place at the end. */
interface Repair {
  user_id: string;
  reason: string;
  patch: Record<string, unknown>;
}

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Fail loud on missing config rather than letting createClient throw a
    // context-free "Internal Server Error" outside the try block.
    const cronSecret = Deno.env.get("CRON_SECRET");
    const serviceRoleKey = Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const missing: string[] = [];
    if (!supabaseUrl) missing.push("SUPABASE_URL");
    if (!serviceRoleKey) missing.push("SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY");
    if (!stripeKey) missing.push("STRIPE_SECRET_KEY");
    if (missing.length) throw new Error(`Missing required env vars: ${missing.join(", ")}`);

    const authHeader = req.headers.get("Authorization");
    if (
      !authHeader ||
      ((!cronSecret || authHeader !== `Bearer ${cronSecret}`) && authHeader !== `Bearer ${serviceRoleKey}`)
    ) {
      return new Response("Unauthorized", { status: 401, headers: corsHeaders });
    }

    const admin = createClient(supabaseUrl!, serviceRoleKey!);
    const stripe = new Stripe(stripeKey!, { apiVersion: "2025-08-27.basil" });

    const url = new URL(req.url);
    const includeSeed = url.searchParams.get("include_seed") === "1";
    const dryRun = url.searchParams.get("dry_run") === "1";

    const notes: string[] = [];
    const caps: string[] = [];
    const repairs: Repair[] = [];
    const now = Date.now();

    const checks = {
      tierWithoutSubscription: new Check(
        "tier_without_subscription",
        "critical",
        "A profile holds a paid tier with NO expiry and no live Stripe subscription — a membership that can never lapse, because expire-subscriptions filters on a non-null expiry. This is the residue the current_period_end outage left behind.",
      ),
      paidButNoTier: new Check(
        "paid_but_no_tier",
        "critical",
        "Stripe has a live, paid subscription on a membership product and the matching profile holds no tier (or the wrong one). The member is being charged and has no access.",
      ),
      tierMismatch: new Check(
        "tier_mismatch",
        "critical",
        "The profile's tier disagrees with the tier of the live Stripe subscription's product.",
      ),
      expiryDrift: new Check(
        "expiry_drift",
        "warning",
        `subscription_expires_at disagrees with the Stripe subscription's current period end by more than ${EXPIRY_TOLERANCE_MS / 3600000}h.`,
      ),
      linkageMissing: new Check(
        "linkage_missing",
        "warning",
        "A live subscription was matched to this profile by email because the profile carried no stripe_subscription_id. Backfilled — email is not a unique key and must not stay the join.",
      ),
      cancelFlagStale: new Check(
        "cancel_flag_stale",
        "warning",
        "subscription_cancel_at_period_end disagrees with Stripe, so the Membership card is saying 'Renews' about a membership that ends (or the reverse).",
      ),
      expireSweepLagging: new Check(
        "expire_sweep_lagging",
        "critical",
        `A tier expired more than ${EXPIRE_GRACE_HOURS}h ago and is still set. expire-subscriptions runs daily at 08:09 UTC; this means it is not clearing.`,
      ),
      duplicateSubscriptionId: new Check(
        "duplicate_subscription_id",
        "critical",
        "One Stripe subscription id appears on more than one profile. One person's payment is entitling several accounts.",
      ),
      unmappedProduct: new Check(
        "unmapped_product",
        "critical",
        "A live subscription's product id is not in PRODUCT_TO_TIER, so no tier can be resolved for it. A paid checkout on this product grants nothing.",
      ),
    };

    // ── 1. Every profile that holds a tier, or claims a Stripe link ──────────
    //
    // `.or()` rather than two round trips: a row with a stale
    // stripe_subscription_id and NO tier is drift too (a subscription that
    // still bills against a profile whose access was cleared), and a
    // tier-only query would never see it.
    let profileQuery = admin
      .from("profiles")
      .select(
        "user_id, email, subscription_tier, subscription_expires_at, stripe_customer_id, stripe_subscription_id, subscription_billing_cycle, subscription_cancel_at_period_end, subscription_source",
      )
      .or("subscription_tier.not.is.null,stripe_subscription_id.not.is.null")
      .limit(SCAN_LIMIT);
    if (!includeSeed) profileQuery = profileQuery.eq("is_seed", false);

    const { data: profileData, error: profileErr } = await profileQuery;
    // Never drop the error, and never let a failed read look like a clean run:
    // a reconciler that reports "no drift" because its own query failed is
    // worse than one that does not run at all.
    if (profileErr) throw new Error(`profiles read failed: ${profileErr.message}`);
    const profiles = (profileData ?? []) as ProfileRow[];
    if (profiles.length >= SCAN_LIMIT) {
      caps.push(`profiles scan hit SCAN_LIMIT (${SCAN_LIMIT}) — results are partial`);
    }

    // Duplicate subscription ids across profiles.
    const bySubId = new Map<string, string[]>();
    for (const p of profiles) {
      if (!p.stripe_subscription_id) continue;
      const list = bySubId.get(p.stripe_subscription_id) ?? [];
      list.push(p.user_id);
      bySubId.set(p.stripe_subscription_id, list);
    }
    for (const [subId, users] of bySubId) {
      if (users.length > 1) {
        // Reported, never auto-repaired: choosing which account keeps the
        // entitlement is a decision about someone's money.
        checks.duplicateSubscriptionId.add({ subscription_id: subId, user_ids: users });
      }
    }

    // ── 2. Stripe's side, in full ────────────────────────────────────────────
    //
    // Listed from Stripe rather than looked up per profile: one paginated
    // sweep instead of N round trips, and — the part that matters — it is the
    // only direction that can see a subscription whose profile was NEVER
    // granted anything. That member is the one the original bug created, and a
    // profile-driven loop is structurally blind to them.
    //
    // `status: "active"` only. A `past_due` or `incomplete` subscription is
    // mid-dunning inside Stripe and grading it here would fight the webhook.
    const liveSubs: Stripe.Subscription[] = [];
    let startingAfter: string | undefined;
    let pages = 0;
    for (;;) {
      const page: Stripe.ApiList<Stripe.Subscription> = await stripe.subscriptions.list({
        status: "active",
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      liveSubs.push(...page.data);
      pages += 1;
      if (!page.has_more || page.data.length === 0) break;
      if (pages >= MAX_STRIPE_PAGES) {
        caps.push(`Stripe subscription scan hit MAX_STRIPE_PAGES (${MAX_STRIPE_PAGES}) — results are partial`);
        break;
      }
      startingAfter = page.data[page.data.length - 1].id;
    }

    // Only membership products. Anything else sharing a Stripe customer (a
    // legacy business seat subscription, a future non-tier product) must not
    // be read as evidence about `subscription_tier` — the same guard both
    // subscription webhook handlers open with.
    const tierSubs = liveSubs.filter((s) => {
      const productId = s.items?.data?.[0]?.price?.product as string | undefined;
      if (!productId) return false;
      if (PRODUCT_TO_TIER[productId]) return true;
      // An unmapped product on a LIVE subscription is itself a finding: this is
      // how test-mode Basic and Pro granted nothing for weeks.
      checks.unmappedProduct.add({ subscription_id: s.id, product_id: productId, customer: s.customer });
      return false;
    });

    // Index Stripe's side by subscription id and by customer id.
    const subById = new Map<string, Stripe.Subscription>();
    const subsByCustomer = new Map<string, Stripe.Subscription[]>();
    for (const s of tierSubs) {
      subById.set(s.id, s);
      const cust = typeof s.customer === "string" ? s.customer : null;
      if (cust) subsByCustomer.set(cust, [...(subsByCustomer.get(cust) ?? []), s]);
    }

    /** Customer emails, fetched only for the subscriptions we could not match by id. */
    const emailForCustomer = new Map<string, string | null>();
    const customerEmail = async (customerId: string): Promise<string | null> => {
      if (emailForCustomer.has(customerId)) return emailForCustomer.get(customerId)!;
      try {
        const c = await stripe.customers.retrieve(customerId);
        const email = (c as Stripe.Customer).email ?? null;
        emailForCustomer.set(customerId, email);
        return email;
      } catch (e) {
        // A single unreadable customer must degrade one row, not the run.
        notes.push(`customer ${customerId} could not be read: ${e instanceof Error ? e.message : String(e)}`);
        emailForCustomer.set(customerId, null);
        return null;
      }
    };

    const profileByUserId = new Map(profiles.map((p) => [p.user_id, p]));
    const profileBySubId = new Map<string, ProfileRow>();
    for (const p of profiles) {
      if (p.stripe_subscription_id && !profileBySubId.has(p.stripe_subscription_id)) {
        profileBySubId.set(p.stripe_subscription_id, p);
      }
    }
    /**
     * Email index. LOWERCASED and multi-valued on purpose: `profiles.email`
     * has no unique constraint, and a case variant or a stale unconfirmed
     * signup would otherwise silently resolve to the wrong account. An
     * ambiguous email is treated as no match at all — the same posture
     * `_resolveUser.ts` takes in the webhook, and for the same reason: handing
     * a paid tier to the wrong person is worse than not handing it out here.
     */
    const profilesByEmail = new Map<string, ProfileRow[]>();
    for (const p of profiles) {
      if (!p.email) continue;
      const key = p.email.trim().toLowerCase();
      profilesByEmail.set(key, [...(profilesByEmail.get(key) ?? []), p]);
    }

    /** Profiles matched to a live subscription during pass 2b. */
    const matchedUserIds = new Set<string>();

    // ── 2b. Stripe → DB ──────────────────────────────────────────────────────
    for (const sub of tierSubs) {
      const productId = sub.items?.data?.[0]?.price?.product as string;
      const expectedTier = PRODUCT_TO_TIER[productId];
      const expectedExpiry = subscriptionCurrentPeriodEndISO(sub);
      const customerId = typeof sub.customer === "string" ? sub.customer : null;

      let profile = profileBySubId.get(sub.id) ?? null;
      let matchedBy: "subscription_id" | "email" = "subscription_id";

      if (!profile) {
        // No stored linkage — fall back to the pre-20260901011254 join, and
        // record that we had to, because that fallback is exactly the weakness
        // this whole change exists to remove.
        const email = customerId ? await customerEmail(customerId) : null;
        const candidates = email ? (profilesByEmail.get(email.trim().toLowerCase()) ?? []) : [];
        if (candidates.length === 1) {
          profile = candidates[0];
          matchedBy = "email";
        } else if (candidates.length > 1) {
          notes.push(`subscription ${sub.id}: ${candidates.length} profiles share ${email} — not matched`);
        }
      }

      if (!profile) {
        // Nothing in `profiles` holds this tier and nothing matches by email.
        // This is the shape of the original outage: charged, no entitlement.
        // Not auto-repairable — there is no account to grant to.
        checks.paidButNoTier.add({
          subscription_id: sub.id,
          customer: customerId,
          expected_tier: expectedTier,
          matched: false,
        });
        continue;
      }

      matchedUserIds.add(profile.user_id);
      const patch: Record<string, unknown> = {};
      const reasons: string[] = [];

      if (profile.subscription_tier !== expectedTier) {
        const c = profile.subscription_tier === null ? checks.paidButNoTier : checks.tierMismatch;
        c.add({
          user_id: profile.user_id,
          subscription_id: sub.id,
          stored_tier: profile.subscription_tier,
          expected_tier: expectedTier,
        });
        patch.subscription_tier = expectedTier;
        reasons.push(`tier ${profile.subscription_tier ?? "null"} -> ${expectedTier}`);
      }

      if (expectedExpiry) {
        const stored = ms(profile.subscription_expires_at);
        const expected = ms(expectedExpiry)!;
        if (stored === null || Math.abs(stored - expected) > EXPIRY_TOLERANCE_MS) {
          checks.expiryDrift.add({
            user_id: profile.user_id,
            subscription_id: sub.id,
            stored: profile.subscription_expires_at,
            expected: expectedExpiry,
          });
          patch.subscription_expires_at = expectedExpiry;
          reasons.push("expiry backfilled from Stripe");
        }
      }
      // An unreadable period end is NOT a silent exemption: it is the exact
      // condition that produced a never-lapsing tier, and it is reported by the
      // tier_without_subscription check below if the stored expiry is null too.

      const linkage = subscriptionLinkage(sub);
      if (profile.stripe_subscription_id !== sub.id) {
        checks.linkageMissing.add({ user_id: profile.user_id, subscription_id: sub.id, matched_by: matchedBy });
        patch.stripe_subscription_id = sub.id;
        patch.stripe_customer_id = linkage.stripe_customer_id;
        patch.subscription_billing_cycle = linkage.subscription_billing_cycle;
        reasons.push("linkage backfilled");
      }
      if ((profile.subscription_cancel_at_period_end ?? false) !== linkage.subscription_cancel_at_period_end) {
        checks.cancelFlagStale.add({
          user_id: profile.user_id,
          stored: profile.subscription_cancel_at_period_end,
          expected: linkage.subscription_cancel_at_period_end,
        });
        patch.subscription_cancel_at_period_end = linkage.subscription_cancel_at_period_end;
        reasons.push("cancel_at_period_end corrected");
      }

      if (Object.keys(patch).length > 0) {
        repairs.push({ user_id: profile.user_id, reason: reasons.join("; "), patch });
      }
    }

    // ── 2c. DB → Stripe ──────────────────────────────────────────────────────
    for (const p of profiles) {
      if (!p.subscription_tier) continue;
      if (matchedUserIds.has(p.user_id)) continue; // already graded against a live sub

      const expiry = ms(p.subscription_expires_at);

      if (expiry !== null && expiry > now) {
        // PAID THROUGH A FUTURE INSTANT. Never drift, whatever Stripe holds.
        // This is the one-time pass, and also a cancelled subscription still
        // inside the period it was paid for. Anchoring on the expiry rather
        // than on "is there a subscription" is what keeps this check from
        // paging on every single pass buyer.
        continue;
      }

      // APPLE ROWS ARE NOT OURS TO GRADE. This whole section reasons "no live
      // Stripe subscription, therefore no subscription", which is sound only
      // where Stripe is the system of record. For an App Store member it is a
      // false premise: there was never going to be a Stripe subscription.
      //
      // Scope, precisely, because it is easy to overstate: the future-expiry
      // guard above ALREADY protects a healthy Apple member, so this is not a
      // nightly mass-clearing — I claimed that in commit 36d2b0606 and it was
      // wrong. What it actually prevents is narrower and still worth fixing.
      //   - A legitimate Apple grant with a NULL expiry (an auto-renewable
      //     transaction Apple returned without an expiresDate) was cleared
      //     outright by the branch below, on the strength of a Stripe
      //     subscription that was never supposed to exist.
      //   - A lapsed Apple member was cleared with the reason "expire-
      //     subscriptions is lagging", a Stripe-framed finding that sends
      //     whoever reads the report looking in the wrong system.
      // expire-subscriptions still clears a genuinely lapsed Apple tier on its
      // own (it filters on a past non-null expiry and does not care who billed
      // it), so skipping here loses no enforcement.
      //
      // Note what is deliberately NOT cleared anywhere:
      // apple_original_transaction_id. It is the only identity the App Store
      // Server Notifications webhook has to find the buyer, so wiping it on a
      // lapse would mean a successful billing retry could never restore the
      // member it belongs to.
      if (p.subscription_source === "apple") {
        continue;
      }

      if (expiry === null) {
        // A tier that can never lapse. expire-subscriptions cannot see it (it
        // filters on a non-null expiry) and it has no live subscription here to
        // restore an expiry from, so the tier is unpaid-for and open-ended.
        checks.tierWithoutSubscription.add({
          user_id: p.user_id,
          email: p.email,
          tier: p.subscription_tier,
          stripe_subscription_id: p.stripe_subscription_id,
          billing_cycle: p.subscription_billing_cycle,
        });
        repairs.push({
          user_id: p.user_id,
          reason: `cleared tier '${p.subscription_tier}' with no expiry and no live Stripe subscription`,
          patch: {
            subscription_tier: null,
            subscription_expires_at: null,
            stripe_subscription_id: null,
            subscription_billing_cycle: null,
            subscription_cancel_at_period_end: false,
          },
        });
        continue;
      }

      // Expired. That is expire-subscriptions' job; only late is a finding.
      if (now - expiry > EXPIRE_GRACE_HOURS * 3600_000) {
        checks.expireSweepLagging.add({
          user_id: p.user_id,
          tier: p.subscription_tier,
          expired_at: p.subscription_expires_at,
          hours_late: Math.round((now - expiry) / 3600_000),
        });
        repairs.push({
          user_id: p.user_id,
          reason: `cleared tier '${p.subscription_tier}' expired ${p.subscription_expires_at}`,
          patch: {
            subscription_tier: null,
            subscription_expires_at: null,
            stripe_subscription_id: null,
            subscription_billing_cycle: null,
            subscription_cancel_at_period_end: false,
          },
        });
      }
    }

    // ── 3. Apply repairs, or refuse to ───────────────────────────────────────
    let repaired = 0;
    const repairFailures: string[] = [];
    let repairsSuppressed = false;

    if (dryRun) {
      notes.push(`dry_run — ${repairs.length} repair(s) computed and NOT applied`);
    } else if (repairs.length > MAX_REPAIRS) {
      // See the header. This is the whole reason writing is acceptable here.
      repairsSuppressed = true;
      notes.push(
        `${repairs.length} repairs exceeded MAX_REPAIRS (${MAX_REPAIRS}) — NOTHING was repaired; drift this wide is systemic and needs a human`,
      );
    } else {
      for (const r of repairs) {
        const { data, error } = await admin
          .from("profiles")
          .update(r.patch)
          .eq("user_id", r.user_id)
          // A null `error` does not mean the write happened. This is an
          // entitlement write; a zero-row UPDATE returns `{data: [], error:
          // null}` and would otherwise be counted as a successful repair.
          .select("user_id");
        if (error) {
          repairFailures.push(`${r.user_id}: ${error.message}`);
        } else if (!data || data.length === 0) {
          repairFailures.push(`${r.user_id}: repair matched 0 rows`);
        } else {
          repaired += 1;
        }
      }
    }

    const findings = Object.values(checks)
      .map((c) => c.finding())
      .filter((f): f is Finding => f !== null);

    const summary = {
      clean: findings.length === 0,
      scope: includeSeed ? "all profiles (seed included)" : "real profiles only (is_seed = false)",
      mode: dryRun ? "dry_run" : "repair",
      profiles_scanned: profiles.length,
      stripe_active_subscriptions: liveSubs.length,
      stripe_tier_subscriptions: tierSubs.length,
      checks_run: Object.values(checks).map((c) => c.name),
      findings_total: findings.length,
      repairs_computed: repairs.length,
      repaired,
      repairs_suppressed: repairsSuppressed,
      findings,
      notes,
      scan_caps: caps,
      run_at: new Date().toISOString(),
    };

    // ── 4. Say something, once, and only when it is worth saying ─────────────
    const worst: Severity | null = findings.some((f) => f.severity === "critical")
      ? "critical"
      : findings.some((f) => f.severity === "warning")
        ? "warning"
        : findings.length
          ? "info"
          : null;

    if (worst) {
      const fields: Record<string, string | number> = {
        scope: summary.scope,
        profiles_scanned: profiles.length,
        repaired: repairsSuppressed ? "0 (SUPPRESSED — see notes)" : repaired,
      };
      // postSlackOpsAlert renders only the first 10 fields, so findings are
      // aggregated per check rather than per row.
      for (const f of findings.slice(0, 7)) {
        fields[f.check] = `${f.count}${f.truncated ? "+" : ""} — ${f.severity}`;
      }
      await postSlackOpsAlert({
        kind: "custom",
        severity: worst,
        title: `Subscription reconciliation found ${findings.length} discrepanc${findings.length === 1 ? "y" : "ies"}`,
        message: repairsSuppressed
          ? "Drift exceeded the automatic-repair ceiling, so NOTHING was corrected. Wide drift means something systemic broke — check the Stripe key mode and PRODUCT_TO_TIER before repairing by hand."
          : "Entitlement state disagreed with Stripe. Small, explicable drift is corrected automatically; see `repaired` for what changed and `findings` for what did not.",
        fields,
      });
    } else if (notes.length) {
      await postSlackOpsAlert({
        kind: "custom",
        severity: "warning",
        title: "Subscription reconciliation ran degraded",
        message: "No drift found, but part of the check could not run — a clean result here is not trustworthy.",
        fields: { notes: notes.join(" | "), scope: summary.scope },
      });
    } else {
      console.log(
        `[subscription-reconciliation] clean — ${profiles.length} profiles, ${tierSubs.length} live tier subscriptions`,
      );
    }

    // Defects are things that are BROKEN, not business outcomes. A repair that
    // failed to write is broken. A capped scan is broken (the answer is
    // partial and a clean result cannot be trusted). Suppressed repairs are
    // broken. Drift itself is a finding, reported and alerted — critical
    // findings are counted too, since a critical here means either a member
    // paid and has no access or an account has access nobody paid for.
    const criticalFindings = findings.filter((f) => f.severity === "critical");
    const defectReasons = [
      ...repairFailures.map((r) => `repair failed — ${r}`),
      ...(repairsSuppressed ? [`repairs suppressed: ${repairs.length} > MAX_REPAIRS`] : []),
      ...caps.map((c) => `partial scan — ${c}`),
      ...criticalFindings.map((f) => `${f.check}: ${f.count}${f.truncated ? "+" : ""}`),
    ];

    return cronResult(
      "subscription-reconciliation",
      summary,
      { count: defectReasons.length, reasons: defectReasons },
      corsHeaders,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[subscription-reconciliation] run failed:", message);
    await postSlackOpsAlert({
      kind: "custom",
      severity: "critical",
      title: "Subscription reconciliation failed to run",
      message: "The daily subscription drift check errored. No entitlement invariants were checked on this run.",
      fields: { error: message },
    }).catch(() => {});
    return cronError("subscription-reconciliation", message, corsHeaders);
  }
});
