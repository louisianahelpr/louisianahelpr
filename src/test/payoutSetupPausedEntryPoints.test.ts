/**
 * CLASS GUARD: every entry point to Helpr payout setup honours the pause
 * (owner ruling by pop-up, 2026-10-23: Stripe closed the platform account;
 * pause ONLY payout-account setup, never posting or paying for jobs).
 *
 * The switch is the hidden feature switch `payout_setup` (migration
 * 20261023201657, created OFF = paused). Two layers, both inventoried from
 * source, so a NEW entry point that skips the switch fails here:
 *
 * SERVER (supabase/functions):
 *   (s1) No edge function but stripe-connect creates a Connect account or an
 *        Account Link (`accounts.create(` / `accountLinks.create(`).
 *   (s2) stripe-connect refuses PAYOUT_SETUP_ACTIONS (read from
 *        _shared/payoutSetupPause.ts) right after it reads `action`, before its
 *        first action branch.
 *   (s3) Every action branch of stripe-connect is classified, EXACT both ways:
 *        PAYOUT_SETUP_ACTIONS (refused up front) or NOT_SETUP below (with the
 *        reason). A new action fails until someone decides which it is.
 *   (s4) Every branch that creates an account or a link, or deletes one
 *        (`accounts.create(`, `accountLinks.create(`, `getOrCreateAccount(`,
 *        `accounts.del(`), is a setup action, or asks payoutSetupPausedFor()
 *        before that call inside the branch (dashboard's non-Express arm).
 *   (s5) The 409's words equal the app notice's (an old build toasts them).
 *
 * CLIENT (src, tests excluded, comments blanked):
 *   An ENTRY POINT is a file that
 *     (m1) invokes stripe-connect with a setup action (onboard /
 *          update_onboarding / reset),
 *     (m2) links to the payout setup screen (`/profile?tab=payment`,
 *          `onSelectTab("payment")`), or
 *     (m3) tells the member, in a string, to set up payouts ("set up payouts",
 *          "add your payout account/bank", "payout bank", "connect a payout
 *          account").
 *   Each one calls usePayoutSetupPaused() or takes the `setupPaused` answer
 *   from a caller that does, OR is a copy module in COPY_MODULES whose every
 *   caller (of the named functions) does, OR is in NOT_AN_ENTRY_POINT with the
 *   reason. Both lists are EXACT both ways (a stale entry fails).
 *
 * The behaviour is proven separately: the real stripe-connect source in
 * src/test/edge/stripeConnectPayoutSetupPaused.test.ts, and the notice in place
 * of each Stripe-starting control in src/components/payouts/payoutSetupPaused.test.tsx.
 * The switch itself (created OFF, paused for every caller including admins and
 * test accounts, admin-only and audited to change) is proved in PGlite:
 * src/test/pglite/payoutSetupSwitch.pglite.mjs (15 PASS; NEW_MIGRATION=skip 6 FAIL).
 *
 * @mutate src/components/PayoutSetupForm.tsx |   const setupPaused = usePayoutSetupPaused();\n  const payoutSources = usePayoutSourcesLine();\n  const setupBlock = usePayoutSetupBlock();\n |   const payoutSources = usePayoutSourcesLine();\n
 * @mutate src/components/AwardGateDialog.tsx |   const setupPaused = usePayoutSetupPaused();\n | \n
 * @mutate src/components/jobDone/JobDoneSummary.tsx |   const setupPaused = usePayoutSetupPaused();\n | \n
 * @mutate src/components/series/SeriesDatesPanel.tsx |   const setupPaused = usePayoutSetupPaused();\n | \n
 * @mutate src/components/shops/ShopPayoutRow.tsx |   const setupBlock = usePayoutSetupBlock(); |   const setupBlock = null as "paused" \| "needs_hire" \| null;
 * @mutate supabase/functions/stripe-connect/index.ts |     if (PAYOUT_SETUP_ACTIONS.has(action) && (await payoutSetupPausedFor(supabaseAdmin, user))) { |     if (PAYOUT_SETUP_ACTIONS.size < 0) {
 * @mutate supabase/functions/stripe-connect/index.ts |       if (account.type !== "express" && (await payoutSetupPausedFor(supabaseAdmin, user))) { |       if (account.type === "none") {
 * @mutate supabase/functions/stripe-connect/index.ts |     if (action === "update_onboarding") { |     if (action === "refresh_onboarding") {
 * @mutate supabase/functions/_shared/payoutSetupPause.ts | Your profile and jobs are not affected. | Your jobs are not affected.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource, readSource } from "./helpers/walkSource";
import { PAYOUT_SETUP_PAUSED_COPY } from "@/lib/payoutSetupPaused";

const ROOT = path.resolve(__dirname, "../..");
const FN_DIR = path.join(ROOT, "supabase/functions");
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

/** stripe-connect actions that are NOT payout setup, each with why. EXACT. */
const NOT_SETUP: Readonly<Record<string, string>> = {
  status: "reads the account; creates nothing",
  list_payout_methods: "reads the saved banks",
  delete_payout_method: "removes a bank from an existing account",
  dashboard: "an Express LOGIN link manages an existing account; its non-Express Account Link arm asks the switch itself (s4)",
};

/** Copy modules: the strings live here, the gate lives in every caller of these functions. EXACT. */
const COPY_MODULES: Readonly<Record<string, readonly string[]>> = {
  // helperApplyBlockNotice -> ApplyBody; awardBlockCopy / acceptPendingCopy -> AwardGateDialog.
  "src/lib/awardGate.ts": ["helperApplyBlockNotice", "awardBlockCopy", "acceptPendingCopy"],
  // claimSetupStep(r, setupPaused) -> SeriesDatesPanel.
  "src/lib/seriesDates.ts": ["claimSetupStep"],
  // checkHelperStripeConnect has no caller today (dead export, reported); a new caller must gate.
  "src/hooks/useStripeConnectCheck.ts": ["checkHelperStripeConnect"],
};

/** Files whose payout words send nobody to setup. EXACT. */
const NOT_AN_ENTRY_POINT: Readonly<Record<string, string>> = {
  "src/components/profile/IdVerifiedPill.tsx": "describes a badge another member earned (\"This member set up payouts with Stripe\")",
  "src/pages/info/legal/TermsSection.tsx": "the Terms of Service text",
  "src/lib/rentals/errorCopy.ts": "the identity_not_verified refusal's words; its first route is the free ID photo review",
  // Server refusal words of sections that are on for testers only (feature_switches read on prod
  // 2026-10-23: declutter, shops, rentals = testers). A static map holds no hook; if a section opens to
  // members while setup is still paused, these words need the paused state (reported to the lead).
  "src/lib/declutter/errors.ts": "Declutter's refusal words (the `declutter` switch is testers-only)",
  "src/lib/shops/errors.ts": "Shops' refusal words (the `shops` switch is testers-only; Shops is on hold)",
  // Owner 2026-10-25: the "You're hired" prompt's words; HiredPayoutSetupDialog and PayoutSetupJobNotice show them and both call usePayoutSetupPaused().
  "src/lib/payoutAfterHire.ts": "the hire prompt's own words; the two components that show them read usePayoutSetupPaused() (and are entry points themselves)",
  // Owner 2026-10-25: the words a member nobody has hired reads in place of setup.
  // Help's Declutter answers (6bd086d8a0) say WHEN setup happens ("at your first paid sale", "after you take your first
  // delivery"); a static answer holds no hook, and no link or control in Help sends anyone to the setup screen.
  "src/pages/info/helpCenter/helpCenterContent.ts": "Help answers that say when payout setup happens; nothing in Help sends anyone to setup",
  "src/lib/payoutSetupPaused.ts": "the notices' own words (\"You'll set up payouts when you're hired\"): they replace setup, they send nobody to it",
};

const M1 = /functions\.invoke\(\s*["']stripe-connect["'][\s\S]{0,400}?["'](?:onboard|update_onboarding|reset)["']|["'](?:onboard|update_onboarding)["'][\s\S]{0,300}?functions\.invoke\(\s*["']stripe-connect["']/;
const M2 = /\/profile\?tab=payment\b|onSelectTab\(\s*["']payment["']\s*\)/;
const M3 = /\bset ?up (?:your )?payouts?\b|\badd (?:a |your )?payout (?:account|bank)\b|\bpayout bank\b|\bconnect a payout account\b/i;
// Evidence a file reads the switch: it calls the hook, or it TAKES the answer from a caller (a typed
// `setupPaused?: boolean` prop or a `setupPaused = false` parameter). A bare `setupPaused` identifier
// is not enough: deleting the hook call leaves the identifier behind (vacuity, 2026-10-23).
const GATED = /\busePayoutSetupPaused\s*\(\s*\)|\busePayoutSetupBlock\s*\(\s*\)|\bsetupPaused\??\s*:\s*boolean\b|\bsetupPaused\s*=\s*false\b/;

export function clientInventory(files: string[]): { entry: string[]; markers: Record<string, string[]>; code: Map<string, string> } {
  const entry: string[] = [];
  const markers: Record<string, string[]> = {};
  const code = new Map<string, string>();
  for (const f of files) {
    const raw = readSource(f);
    if (raw === null) continue;
    const c = blankComments(raw);
    code.set(rel(f), c);
    const m = [M1.test(c) && "m1", M2.test(c) && "m2", M3.test(c) && "m3"].filter(Boolean) as string[];
    if (m.length) {
      entry.push(rel(f));
      markers[rel(f)] = m;
    }
  }
  return { entry: entry.sort(), markers, code };
}

export function ungatedEntryPoints(inv: ReturnType<typeof clientInventory>): string[] {
  const bad: string[] = [];
  for (const f of inv.entry) {
    if (NOT_AN_ENTRY_POINT[f]) continue;
    const c = inv.code.get(f) ?? "";
    if (COPY_MODULES[f]) {
      for (const fn of COPY_MODULES[f]) {
        const call = new RegExp(`\\b${fn}\\s*\\(`);
        for (const [other, oc] of inv.code) {
          if (other === f || !call.test(oc)) continue;
          if (!GATED.test(oc)) bad.push(`${other}: calls ${fn}() from ${f} without usePayoutSetupPaused()`);
        }
      }
      continue;
    }
    if (!GATED.test(c)) bad.push(`${f} (${inv.markers[f].join(",")}): an entry point to payout setup that never reads usePayoutSetupPaused()`);
  }
  return bad;
}

const srcFiles = () =>
  walkSource([path.join(ROOT, "src")]).filter((p) => !/\.test\.(ts|tsx)$/.test(p) && !p.includes(`${path.sep}src${path.sep}test${path.sep}`));

/** stripe-connect's action branches: name -> branch body (to the next branch). */
export function actionBranches(code: string): Map<string, { start: number; body: string }> {
  const out = new Map<string, { start: number; body: string }>();
  const hits = [...code.matchAll(/\bif\s*\(\s*action\s*===\s*"([a-z_]+)"\s*\)\s*\{/g)];
  hits.forEach((h, i) => {
    const end = i + 1 < hits.length ? hits[i + 1].index! : code.length;
    out.set(h[1], { start: h.index!, body: code.slice(h.index!, end) });
  });
  return out;
}

const CREATES = /\baccounts\.create\s*\(|\baccountLinks\.create\s*\(|\bgetOrCreateAccount\s*\(|\baccounts\.del\s*\(/;

describe("payout setup paused: every entry point honours the switch", () => {
  const shared = blankComments(read("supabase/functions/_shared/payoutSetupPause.ts"));
  const setupActions = new Set(
    [...(/PAYOUT_SETUP_ACTIONS[^=]*=\s*new Set\(\[([^\]]*)\]\)/.exec(shared)?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]),
  );
  const connect = blankComments(read("supabase/functions/stripe-connect/index.ts"));
  const branches = actionBranches(connect);

  it("reads a real inventory (floors)", () => {
    expect(setupActions.size).toBeGreaterThan(2);
    expect(branches.size).toBeGreaterThan(6);
    const inv = clientInventory(srcFiles());
    expect(inv.entry.length).toBeGreaterThan(15);
    expect(inv.entry.filter((f) => inv.markers[f].includes("m1")).length).toBeGreaterThan(1);
    expect(inv.entry.filter((f) => inv.markers[f].includes("m2")).length).toBeGreaterThan(5);
  });

  it("(s1) only stripe-connect creates a Connect account or an Account Link", () => {
    const makers = walkSource([FN_DIR])
      .filter((f) => /\baccounts\.create\s*\(|\baccountLinks\.create\s*\(/.test(blankComments(readSource(f) ?? "")))
      .map(rel);
    expect(makers).toEqual(["supabase/functions/stripe-connect/index.ts"]);
  });

  it("(s2) stripe-connect refuses the setup actions before its first action branch", () => {
    const actionRead = connect.search(/const\s*\{\s*action\s*\}\s*=\s*body\s*;/);
    const gate = connect.search(/if\s*\(\s*PAYOUT_SETUP_ACTIONS\.has\(action\)\s*&&\s*\(await payoutSetupPausedFor\(supabaseAdmin,\s*user\)\)\)\s*\{\s*return payoutSetupPausedResponse\(corsHeaders\);/);
    const firstBranch = Math.min(...[...branches.values()].map((b) => b.start));
    expect(actionRead).toBeGreaterThan(0);
    expect(gate, "the PAYOUT_SETUP_ACTIONS refusal is missing").toBeGreaterThan(actionRead);
    expect(gate).toBeLessThan(firstBranch);
  });

  it("(s3) every stripe-connect action is classified, exact both ways", () => {
    const handled = [...branches.keys()].sort();
    const classified = [...setupActions, ...Object.keys(NOT_SETUP)].sort();
    expect(handled).toEqual(classified);
    for (const a of setupActions) expect(NOT_SETUP[a], `${a} is both setup and not`).toBeUndefined();
  });

  it("(s4) every branch that makes or deletes an account or link is setup, or asks the switch first", () => {
    const bad: string[] = [];
    let makers = 0;
    for (const [name, b] of branches) {
      const at = b.body.search(CREATES);
      if (at < 0) continue;
      makers++;
      if (setupActions.has(name)) continue;
      // Every such call in the branch must come after an ask of the switch.
      for (const m of b.body.matchAll(new RegExp(CREATES.source, "g"))) {
        const ask = b.body.slice(0, m.index!).search(/\bpayoutSetupPausedFor\s*\(/);
        if (ask < 0) bad.push(`${name}: ${m[0]} without payoutSetupPausedFor() before it`);
      }
    }
    expect(makers).toBeGreaterThan(3);
    expect(bad).toEqual([]);
  });

  it("(s5) the 409 carries the notice's exact words and code", () => {
    const msg = /PAYOUT_SETUP_PAUSED_MESSAGE\s*=\s*"([^"]*)"/.exec(read("supabase/functions/_shared/payoutSetupPause.ts"))?.[1];
    expect(msg).toBe(PAYOUT_SETUP_PAUSED_COPY);
    expect(shared).toMatch(/PAYOUT_SETUP_PAUSED_CODE\s*=\s*"payout_setup_paused"/);
    expect(shared).toMatch(/status:\s*409/);
  });

  it("(client) every entry point reads usePayoutSetupPaused()", () => {
    const inv = clientInventory(srcFiles());
    expect(ungatedEntryPoints(inv)).toEqual([]);
  });

  it("(client) every <PayoutStatusRow> outside its own file passes setupPaused", () => {
    const inv = clientInventory(srcFiles());
    let uses = 0;
    const bad: string[] = [];
    for (const [f, c] of inv.code) {
      if (f.endsWith("profileLanding/PayoutStatusRow.tsx")) continue;
      for (const m of c.matchAll(/<PayoutStatusRow\b([\s\S]*?)\/>/g)) {
        uses++;
        if (!/\bsetupPaused=\{/.test(m[1])) bad.push(f);
      }
    }
    expect(uses).toBeGreaterThan(2);
    expect(bad).toEqual([]);
  });

  it("(client) COPY_MODULES and NOT_AN_ENTRY_POINT are exact (each names a file the inventory finds)", () => {
    const inv = clientInventory(srcFiles());
    for (const f of [...Object.keys(COPY_MODULES), ...Object.keys(NOT_AN_ENTRY_POINT)]) {
      expect(inv.entry, `${f} is listed but no longer an entry point: remove it`).toContain(f);
    }
    for (const f of Object.keys(NOT_AN_ENTRY_POINT)) {
      expect(GATED.test(inv.code.get(f) ?? ""), `${f} reads the switch; it does not need an exemption`).toBe(false);
    }
  });

  it("the scanner sees a planted ungated entry point (self-test)", () => {
    const planted = new Map<string, string>([
      ["src/x/Nudge.tsx", 'export const N = () => <Link to="/profile?tab=payment">Go</Link>;'],
      ["src/x/Copy.tsx", 'export const C = () => <p>Add your payout account to get paid.</p>;'],
      ["src/x/Call.tsx", 'await supabase.functions.invoke("stripe-connect", { body: { action: "onboard" } });'],
      ["src/x/Ok.tsx", 'const setupPaused = usePayoutSetupPaused(); <Link to="/profile?tab=payment" />'],
    ]);
    const inv = { entry: [...planted.keys()].sort(), markers: Object.fromEntries([...planted.keys()].map((k) => [k, ["m"]])), code: planted };
    expect(ungatedEntryPoints(inv).map((l) => l.split(" ")[0]).sort()).toEqual(["src/x/Call.tsx", "src/x/Copy.tsx", "src/x/Nudge.tsx"]);
    expect([...planted.values()].filter((c) => M1.test(c) || M2.test(c) || M3.test(c)).length).toBe(4);
  });
});
