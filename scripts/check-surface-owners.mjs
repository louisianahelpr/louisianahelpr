#!/usr/bin/env node
/**
 * Every product surface must have a named DOMAIN owner. Fail if one does not.
 *
 * WHY THIS EXISTS — the audit registry was checking itself.
 * `scripts/audit-coverage.mjs` maps surface CLASSES to lanes: "`?tab=` variants
 * -> lh-route-walker + lh-state-matrix". That row renders green across all 23
 * tabs and it is perfectly true — every tab does get walked, fitted and
 * state-forced. It is also useless for the question that matters, because
 * nothing in it asks WHO CHECKS WHAT THE EARNINGS TAB COMPUTES. The class was
 * owned; the instances never were. A registry validated against its own
 * taxonomy passes for the same reason it is worthless.
 *
 * The owner found this from outside in under two minutes, by asking whether the
 * profile tabs and the six post-a-job entry paths belonged to any team. They
 * did not. Measured across 39 lane definitions at the time:
 *   - `?tab=saved_helpers` and all SIX post-job entry paths (start fresh,
 *     draft, repost, template, AI builder, offer to a saved helpr) were named
 *     by ZERO lane.
 *   - `/payment-success` — the Stripe checkout RETURN page — was named only by
 *     lh-native-bridge, which owns the native handoff, not the page. The money
 *     lane's scope did not contain it. Neither did it contain `?tab=earnings`.
 *
 * WHY AN EXPLICIT TABLE AND NOT A GREP.
 * The throwaway version of this scored ownership by grepping lane prose for the
 * surface's name. That is how it produced 21 "orphans" of which 14 were false —
 * lanes say "sign in", not "/login". Worse, prose-matching means a lane can
 * "own" a surface by coincidence: lh-seo-web mentions `/jobs/:id` because it
 * checks the meta tags, which is not the same as owning the page. So ownership
 * is DECLARED here, per surface, and the enumeration is mechanical. Adding a
 * route without assigning an owner fails the build. That is the only shape of
 * this check that cannot quietly go vacuous again.
 *
 * Structural lanes (route-walker, state-matrix, visual-critic, webkit-differ,
 * a11y-sensory) are deliberately NOT accepted as owners. They cover every
 * surface by construction, so counting them would make every row green and
 * reproduce the exact bug this file exists to break.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";

const STRUCTURAL = new Set([
  "lh-route-walker", "lh-state-matrix", "lh-visual-critic",
  "lh-webkit-differ", "lh-a11y-sensory", "lh-verifier", "lh-suggester",
]);

/**
 * surface -> the domain lane(s) that must give it a verdict.
 * A surface may legitimately have several. It may not have none.
 */
const OWNERS = {
  // ── public / marketing ───────────────────────────────────────────────────
  "/": ["lh-seo-web", "lh-copy-content"],
  "/browse": ["lh-browse-discovery"],
  "/jobs": ["lh-browse-discovery"],
  "/jobs/:id": ["lh-browse-discovery", "lh-seo-web", "lh-trust-safety"],
  "/j/:id": ["lh-browse-discovery"],
  "/u/:id": ["lh-trust-safety"],
  "/m/:id": ["lh-notifications"],
  "/legal": ["lh-compliance-store", "lh-copy-content"],
  "/legal/:tab": ["lh-compliance-store", "lh-copy-content"],
  "/privacy": ["lh-compliance-store"],
  "/terms": ["lh-compliance-store"],
  "/rules": ["lh-trust-safety", "lh-copy-content"],
  "/support": ["lh-copy-content"],
  "/help": ["lh-copy-content"],
  "/data-rights": ["lh-compliance-store", "lh-account-lifecycle"],
  "/gift-card": ["lh-compliance-store", "lh-subscriptions-credits"],

  // ── auth / account state ─────────────────────────────────────────────────
  "/login": ["lh-onboarding-auth"],
  "/signup": ["lh-onboarding-auth"],
  "/signup-pending": ["lh-onboarding-auth", "lh-verification-credentials"],
  "/complete-profile": ["lh-onboarding-auth"],
  // The SCREENS, not the email. lh-email-delivery owns whether the mail is
  // sent and lands; it does not own what the reset page does with an expired
  // or replayed token, which is where the defect would be.
  "/forgot-password": ["lh-onboarding-auth"],
  "/reset-password": ["lh-onboarding-auth"],
  "/account-pending": ["lh-verification-credentials"],
  "/account-denied": ["lh-verification-credentials"],
  "/account-banned": ["lh-trust-safety"],

  // ── core loop ────────────────────────────────────────────────────────────
  "/dashboard": ["lh-design-holes", "lh-copy-content"],
  "/dashboard/post-login": ["lh-onboarding-auth"],
  "/activity": ["lh-design-holes", "lh-scheduling-time"],
  "/my-jobs": ["lh-design-holes"],
  "/my-posts": ["lh-design-holes"],
  "/post-job": ["lh-input-boundary", "lh-money-escrow"],
  "/post-job/*": ["lh-input-boundary", "lh-money-escrow"],
  "/messages": ["lh-trust-safety"],
  "/messages/:id": ["lh-trust-safety", "lh-input-boundary"],
  // The Stripe checkout RETURN. Was owned only by lh-native-bridge, which
  // covers the native handoff and not what this page asserts about the money.
  "/payment-success": ["lh-money-escrow", "lh-native-bridge"],
  "/earnings": ["lh-money-escrow"],
  "/saved-helpers": ["lh-trust-safety"],
  "/schedule": ["lh-scheduling-time"],
  "/availability": ["lh-scheduling-time"],
  "/warnings": ["lh-trust-safety", "lh-admin-moderation"],

  // ── settings / profile / long tail ───────────────────────────────────────
  "/profile": ["lh-input-boundary"],
  "/settings": ["lh-onboarding-auth"],
  "/settings/profile": ["lh-input-boundary"],
  "/user/:userId": ["lh-trust-safety"],
  "/admin": ["lh-admin-moderation"],

  // ── profile tabs (?tab=) ─────────────────────────────────────────────────
  "?tab=profile": ["lh-input-boundary"],
  "?tab=earnings": ["lh-money-escrow"],
  "?tab=payment": ["lh-money-escrow"],
  "?tab=schedule": ["lh-scheduling-time"],
  "?tab=availability": ["lh-scheduling-time"],
  "?tab=security": ["lh-onboarding-auth"],
  "?tab=legal": ["lh-compliance-store", "lh-copy-content"],
  "?tab=reviews": ["lh-trust-safety"],
  "?tab=referral": ["lh-subscriptions-credits"],
  "?tab=subscription": ["lh-subscriptions-credits"],
  "?tab=support": ["lh-copy-content"],
  "?tab=notifications": ["lh-notifications"],
  "?tab=warnings": ["lh-trust-safety", "lh-admin-moderation"],
  "?tab=credentials": ["lh-verification-credentials"],
  "?tab=saved_helpers": ["lh-trust-safety"],
  // Co-owned: the a11y lane judges whether the settings WORK across screens,
  // lh-input-boundary owns the tab as a form. A structural lane may co-own a
  // surface; it may never be the only owner (see the rule below).
  "?tab=accessibility": ["lh-input-boundary", "lh-a11y-sensory"],
  "?tab=pets": ["lh-long-tail-features"],
  "?tab=work_record": ["lh-long-tail-features"],
  "?tab=home_history": ["lh-long-tail-features"],
  "?tab=wrapped": ["lh-long-tail-features"],
  "?tab=str_settings": ["lh-long-tail-features"],
  "?tab=analytics": ["lh-long-tail-features"],
  "?tab=auto_tip": ["lh-subscriptions-credits", "lh-money-escrow"],

  // ── post-a-job entry paths ───────────────────────────────────────────────
  // Six ship; EntryChoice's own docblock still describes three. Every one of
  // these pre-fills the form that takes the poster's money, and not one was
  // named by any lane.
  "entry:start-fresh": ["lh-input-boundary"],
  "entry:draft": ["lh-input-boundary", "lh-concurrency-cache"],
  "entry:repost": ["lh-money-escrow", "lh-input-boundary"],
  "entry:template": ["lh-input-boundary"],
  "entry:ai-builder": ["lh-input-boundary", "lh-appsec"],
  "entry:offer-saved-helpr": ["lh-trust-safety", "lh-money-escrow"],
};

const problems = [];
const knownLanes = new Set(
  readdirSync(".claude/agents").filter((f) => f.startsWith("lh-") && f.endsWith(".md")).map((f) => f.replace(/\.md$/, "")),
);

// ── enumerate: routes ───────────────────────────────────────────────────────
const enumerated = [];
for (const m of readFileSync("src/App.tsx", "utf8").matchAll(/path="([^"]+)"/g)) {
  if (m[1] === "*") continue; // catch-all 404, not a product surface
  enumerated.push(m[1]);
}

// ── enumerate: profile tabs, from the same constant the app routes on ──────
if (existsSync("src/pages/profile/types.ts")) {
  const t = readFileSync("src/pages/profile/types.ts", "utf8");
  const i = t.indexOf("TAB_TITLES");
  for (const m of t.slice(i, t.indexOf("};", i)).matchAll(/^\s*(\w+):\s*"/gm)) enumerated.push(`?tab=${m[1]}`);
}

// ── enumerate: post-job entry paths ────────────────────────────────────────
// Keyed off the numbered section comments in EntryChoice so a NEW option
// cannot be added without this list noticing it is unowned.
if (existsSync("src/pages/postjob/EntryChoice.tsx")) {
  const src = readFileSync("src/pages/postjob/EntryChoice.tsx", "utf8");
  // Trailing punctuation is NOT part of the name: the section comments read
  // "3 — REPOST A RECENT TASK (collapsed by default)" and "6 — OFFER TO A
  // SAVED HELPR. The direct-offer flow's...". Capturing greedily gave
  // "REPOST A RECENT TASK (" and "OFFER TO A SAVED HELPR. T".
  const sections = [...src.matchAll(/\{\/\*\s*\d+\s*—\s*([A-Z][A-Z ']*[A-Z])/g)].map((m) => m[1].trim());
  const SLUG = {
    "START FRESH": "entry:start-fresh", "LOAD DRAFT": "entry:draft",
    "REPOST A RECENT TASK": "entry:repost", "USE A TEMPLATE": "entry:template",
    "AI JOB BUILDER": "entry:ai-builder", "OFFER TO A SAVED HELPR": "entry:offer-saved-helpr",
  };
  for (const s of sections) {
    const slug = SLUG[s];
    if (!slug) { problems.push(`EntryChoice has a section "${s}" this file has never heard of — add it to SLUG and give it an owner`); continue; }
    enumerated.push(slug);
  }
}

// ── check ───────────────────────────────────────────────────────────────────
for (const s of [...new Set(enumerated)]) {
  const owners = OWNERS[s];
  if (!owners || owners.length === 0) { problems.push(`${s} — NO domain lane owns this surface`); continue; }
  for (const o of owners) {
    if (!knownLanes.has(o)) problems.push(`${s} — owner \`${o}\` is not a lane that exists`);
  }
  // A structural lane may CO-own a surface — lh-a11y-sensory genuinely owns
  // whether the accessibility tab's toggles work. What it may never be is the
  // only owner: structural lanes cover everything by construction, so a
  // surface whose sole owner is structural is exactly as unaudited as one with
  // no owner, while reading green. That is the bug this file exists to break.
  if (owners.every((o) => STRUCTURAL.has(o))) {
    problems.push(`${s} — owned ONLY by structural lane(s) (${owners.join(", ")}); structural lanes cover every surface by construction, so this surface has no domain owner`);
  }
}
const stale = Object.keys(OWNERS).filter((k) => !enumerated.includes(k));
for (const s of stale) problems.push(`${s} — declared here but no longer exists in the app; remove it`);

if (enumerated.length === 0) {
  console.error("✖ Enumerated ZERO surfaces. Refusing to report success — that is the vacuous pass this file exists to prevent.");
  process.exit(1);
}
if (problems.length === 0) {
  console.log(`✔ surface ownership: ${new Set(enumerated).size} surfaces, every one owned by a named domain lane`);
  process.exit(0);
}
console.error(`\n✖ ${problems.length} surface ownership problem(s), out of ${new Set(enumerated).size} surfaces.\n`);
for (const p of problems) console.error(`    ${p}`);
console.error("\n  A surface nobody owns is not audited, however green the coverage table looks.");
console.error("  Assign it a domain lane in scripts/check-surface-owners.mjs and add it to that lane's scope.\n");
process.exit(1);
