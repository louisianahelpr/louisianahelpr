/**
 * CLASS GUARD (owner 2026-11-20, pop-up): NO ID check and NO $2 account setup fee anywhere in Declutter, for the
 * seller (listing, payout), the buyer (offer, counter, bundle ask, trade, checkout) and the free claimer. Job posters,
 * Helprs and delivery Helprs keep both; Shops keeps its own (testers-only, not part of the ruling). Migration
 * 20261120184430 removed every server refusal; declutter-money stopped holding a Declutter payout on the ID check and
 * stopped taking the fee from it; the client lost every Declutter gate, prompt, fee line and fee figure.
 *
 * Inventoried from source, so a NEW Declutter path that asks for an ID or the fee fails here:
 *   (s1) every Declutter SQL function (declutter_*, the NEWEST definition) calls none of the ID or fee gates and raises
 *        none of their refusals, apart from the shared helpers listed in SHARED (exact both ways).
 *   (s2) no live trigger on a declutter_* table runs a function that does.
 *   (s3) checkout freezes setup_fee_cents = 0, and the seller's payout take never takes it.
 *   (s4) declutter-money skips the ID hold for both Declutter payout kinds and never asks for the fee.
 *   (c1) no Declutter client file opens the ID sheet, reads the ID switch for a gate, or adds the setup fee.
 *   (c2) no Declutter dictionary (English or Spanish) names an ID check or the setup fee.
 * Behaviour: src/test/pglite/declutterNoIdNoSetupFee.pglite.mjs (the real old triggers refuse, then do not);
 * the payout run: src/test/edge/declutter-money.test.ts ("owner 11-20").
 *
 * @mutate supabase/migrations/20261120184430_declutter_no_id_no_setup_fee.sql |   v_setup := 0;\n |   v_setup := public.declutter_setup_fee_due_cents(v_uid);\n
 * @mutate supabase/functions/_shared/payoutHold.ts |   return kind === "declutter"; |   return kind === "declutter" \|\| kind === "declutter_manager";
 * @mutate src/components/declutter/BuyerTotal.tsx | {formatPrice(buyNowTotalCents(priceCents) + addCents)} | {formatPrice(buyNowTotalCents(priceCents) + addCents + useFirstPayoutFeeCents())}
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { triggerInventory } from "./helpers/migrationTriggers";
import { walkSource, readSource } from "./helpers/walkSource";
import { readdirSync as trackedReaddir } from "./helpers/trackedFiles";

const ROOT = path.resolve(__dirname, "../..");
const MIG_DIR = path.join(ROOT, "supabase/migrations");
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");

/** Calls and refusals that ask for an ID or the setup fee. */
const GATE = /\bdeclutter_identity_gate\s*\(|\bis_identity_verified\s*\(|\bidentity_check_exempt\s*\(|\bpayout_waits_on_identity\s*\(|\bdeclutter_free_claim_gate\s*\(|\bdeclutter_setup_fee_due_cents\s*\(|\bdeclutter_setup_fee_from_payout_cents\s*\(|'identity_required_to_[a-z]+'|'setup_fee_required_to_[a-z]+'|'identity_check'/;

/** Declutter-named functions that may still read a gate, each with why. EXACT both ways. */
const SHARED: Readonly<Record<string, string>> = {
  declutter_identity_gate: "the shared gate Shops' list and buy triggers call (shop_identity_before_list / _buy); no Declutter path calls it",
  declutter_setup_fee_due_cents: "the shared fee reader Shops and the delivery Helpr's payout use; no Declutter path calls it",
  declutter_setup_fee_from_payout_cents: "the shared from-payout fee reader the delivery Helpr's and Shops' payout takes use; no Declutter path calls it",
  declutter_delivery_tip_open: "a tip for the DELIVERY HELPR waits on the Helpr's ID (kept by the ruling)",
  declutter_free_asks_reopen_on_back_up: "reads the identity_check switch only to decide whether other asks reopen when a free item comes back up; it asks nobody for an ID",
};

describe("Declutter asks for no ID check and no setup fee (owner 2026-11-20)", () => {
  const defs = effectiveDefs(MIG_DIR);
  const declutterFns = [...defs.keys()].filter((n) => n.startsWith("declutter_"));

  it("reads a real inventory (floor)", () => {
    expect(declutterFns.length).toBeGreaterThan(200);
  });

  it("(s1) no Declutter function calls an ID or fee gate, apart from the shared helpers (exact both ways)", () => {
    const readers = declutterFns.filter((n) => GATE.test(blankSqlComments(defs.get(n)!.stmt))).sort();
    expect(readers).toEqual(Object.keys(SHARED).sort());
  });

  it("(s2) no live trigger on a declutter_* table runs a gate", () => {
    const inv = triggerInventory(migrationFiles(MIG_DIR).map((f) => ({ name: f, sql: fs.readFileSync(path.join(MIG_DIR, f), "utf8") })));
    const bad = [...inv.values()].filter((t) => t.table.startsWith("declutter_"))
      .filter((t) => !(t.fn in SHARED) && (GATE.test(blankSqlComments(defs.get(t.fn)?.stmt ?? "")) || /identity|setup_fee/.test(t.fn)))
      .map((t) => `${t.name} ON ${t.table} -> ${t.fn}`);
    expect(bad).toEqual([]);
    expect(defs.has("declutter_identity_before_buy")).toBe(false);
    expect(defs.has("declutter_setup_fee_before_list")).toBe(false);
    expect(defs.has("declutter_free_claim_gate")).toBe(false);
  });

  it("(s3) checkout freezes no setup fee, and the seller's payout take returns the payout whole", () => {
    const checkout = blankSqlComments(defs.get("declutter_start_checkout")!.stmt);
    expect(checkout).toMatch(/v_setup\s*:=\s*0\s*;/);
    expect(checkout).not.toMatch(/v_setup\s*:=\s*public\./);
    const take = blankSqlComments(defs.get("declutter_payout_take_setup_fee")!.stmt);
    expect(take).not.toMatch(/UPDATE\s+public\.(profiles|declutter_payouts)/i);
    expect(take).toMatch(/RETURN\s+p\.amount_cents\s*;\s*END/i);
    const mine = blankSqlComments(defs.get("declutter_my_setup_fee")!.stmt);
    expect(mine).toMatch(/'fee_cents',\s*0/);
    expect(mine).not.toMatch(/setup_fee_from_payout/);
  });

  it("(s4) declutter-money: no ID hold for a Declutter seller; a manager (Helpr-type role) and a delivery Helpr still wait; no fee taken", () => {
    const hold = fs.readFileSync(path.join(ROOT, "supabase/functions/_shared/payoutHold.ts"), "utf8");
    const fn = /export function declutterKindSkipsIdHold\(kind: string\): boolean \{\s*return ([^;]+);/.exec(hold)?.[1] ?? "";
    expect(fn).toBe('kind === "declutter"');
    const money = blankComments(fs.readFileSync(path.join(ROOT, "supabase/functions/declutter-money/index.ts"), "utf8"));
    // A Shops seller skips it too (owner 2026-11-20, 20261120203904; src/test/shopsNoIdCheck.test.ts).
    expect(money).toContain('const idHold = declutterKindSkipsIdHold(kind) || kind === "shop" ? { kind: "clear" as const } : await checkIdentityHold(admin, payeeId);');
    expect(money.match(/checkIdentityHold\(/g)?.length).toBe(1);
    expect(money).not.toContain("declutter_payout_take_setup_fee");
    // The delivery Helpr's fee (kept) is still taken.
    expect(money).toContain('admin.rpc("helpr_task_payout_take_setup_fee"');
    // Review of #4820: no Declutter edge function reads the shared fee reader (it still answers 200 for Jobs fees).
    const edgeDirs = trackedReaddir(path.join(ROOT, "supabase/functions")).filter((d) => d.startsWith("declutter-"));
    expect(edgeDirs.length).toBeGreaterThan(3);
    const readers = walkSource(edgeDirs.map((d) => path.join(ROOT, "supabase/functions", d)))
      .filter((f) => /declutter_setup_fee_due_cents/.test(blankComments(readSource(f) ?? ""))).map(rel);
    expect(readers).toEqual([]);
  });

  it("(c1) no Declutter client file opens the ID sheet, gates on the ID switch, or adds the setup fee", () => {
    const ASK = /\bopenIdentityCheck(?:OrSay)?\s*\(|\bidentityRefusal\s*\(|\bneedsIdentityCheck\s*\(|\buseIdentityCheck(?:On|OnStore|Status)\s*\(|\bidentityCheckOn\s*\(|\buseFirstPayoutFee(?:Cents|Known|Dollars)\s*\(|pay-onboarding-fee|setup_fee_required_to_|identity_required_to_|declutter_my_setup_fee|verify_id=1/;
    const files = walkSource([path.join(ROOT, "src/components/declutter"), path.join(ROOT, "src/lib/declutter")])
      .filter((f) => !/\.test\.(ts|tsx)$/.test(f));
    expect(files.length).toBeGreaterThan(150);
    const bad = files.filter((f) => ASK.test(blankComments(readSource(f) ?? ""))).map(rel);
    expect(bad).toEqual([]);
    // Home's Declutter to-dos (review of #4820): no "Verify your ID to get paid" item and no Declutter payout ID read.
    // (Home's Jobs money tiles keep the Helpr's first-payout setup fee, so useFirstPayoutFee is allowed there.)
    const HOME_ASK = /\bopenIdentityCheck(?:OrSay)?\s*\(|\bneedsIdentityCheck\s*\(|verify_id=1|idPayoutWait|declutterIdPayoutCents|todo\.idPayout|todo\.verifyId|declutter_my_setup_fee/;
    const home = walkSource([path.join(ROOT, "src/pages/home")]).filter((f) => !/\.test\.(ts|tsx)$/.test(f));
    expect(home.some((f) => f.endsWith("needsYouTodos.ts"))).toBe(true);
    expect(home.filter((f) => HOME_ASK.test(blankComments(readSource(f) ?? ""))).map(rel)).toEqual([]);
  });

  it("(c2) no Declutter dictionary names an ID check or the setup fee, in English or Spanish", () => {
    const WORDS = /\bID check|\bsetup fee|verify your ID|photo ID|verificación de identidad|identificación con foto|cargo único|tarifa única/i;
    const dir = path.join(ROOT, "src/lib/i18n");
    const dicts = trackedReaddir(dir).filter((f) => /^(en|es)(Decl|Free|Listing|Sell|ListFor)\w*\.ts$/.test(f));
    expect(dicts.length).toBeGreaterThan(25);
    const bad: string[] = [];
    for (const f of dicts) {
      for (const line of blankComments(fs.readFileSync(path.join(dir, f), "utf8")).split("\n")) {
        if (WORDS.test(line)) bad.push(`${f}: ${line.trim().slice(0, 100)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
