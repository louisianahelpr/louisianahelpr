/**
 * Owner 11-12 1:00 AM (OWNER-DECISIONS.md): a Declutter seller's ID check moves from the first listing to the FIRST
 * PAYOUT. Listings go live right away; the payout waits until the seller is verified; the seller is told "Verify your
 * ID to get paid $X" on Selling, on Home's to-do and in the handover notice. The behaviour is proven in PGlite
 * (src/test/pglite/sellerIdAtFirstPayout.pglite.mjs: listing publishes unverified; payout_waits_on_identity waits, then
 * clears after verification) and in the payout run (src/test/edge/declutter-money.test.ts "owner 11-12": no transfer
 * while unverified, sent once verified); this guard holds the shipped definitions and the prompts to it.
 *
 * @mutate supabase/migrations/20261112065000_declutter_seller_id_at_first_payout.sql | DROP TRIGGER IF EXISTS trg_declutter_items_identity_before_list ON public.declutter_items;\n |
 * @mutate supabase/migrations/20261112065000_declutter_seller_id_at_first_payout.sql |       WHEN public.payout_waits_on_identity(o.seller_id) THEN\n        format('Verify your ID to get paid | WHEN false THEN\n        format('Verify your ID to get paid
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts |   if ((i.declutterIdPayoutCents ?? 0) > 0) { |   if (false) {
 * @mutate src/lib/declutter/idPayoutWait.ts | p.status === "pending" \|\| p.status === "failed" ? | p.status !== "succeeded" ?
 * @mutate supabase/functions/declutter-money/index.ts |         if (!(await stillPayableNow("declutter", p.payout_id, p.seller_id, p.amount_cents))) continue; |         if (false) continue;
 * @mutate src/components/declutter/SellerPayoutPrompt.tsx |       <IdPayoutPrompt cents={waiting.cents} titles={waiting.titles} />\n |
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { triggerInventory } from "./helpers/migrationTriggers";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");
const DIR = join(ROOT, "supabase", "migrations");
const defs = effectiveDefs(DIR);
const body = (name: string) => defs.get(name)?.stmt ?? "";

describe("Declutter: the seller's ID check is at the first payout, not the listing (owner 11-12)", () => {
  it("no trigger on declutter_items asks for the ID check (the listing gate is gone, nothing re-creates it)", () => {
    const files = migrationFiles(DIR);
    expect(files.length).toBeGreaterThan(100);
    const inv = triggerInventory(files.map((name) => ({ name, sql: readFileSync(join(DIR, name), "utf8") })));
    const onItems = [...inv.values()].filter((t) => t.table === "declutter_items");
    expect(onItems.length, "the inventory read declutter_items' triggers").toBeGreaterThan(0);
    expect(onItems.map((t) => t.name)).not.toContain("trg_declutter_items_identity_before_list");
    for (const t of onItems) expect(body(t.fn), `${t.name} -> ${t.fn}`).not.toMatch(/identity_required_to_list|declutter_identity_gate/);
  });

  it("the buyer's gates stay (declutter_identity_gate still refuses a first purchase)", () => {
    expect(body("declutter_identity_before_buy")).toContain("'identity_required_to_buy'");
  });

  it("the payout run asks the ID rule right before every seller transfer (the one hold; no second one in SQL)", () => {
    const run = blankComments(readFileSync(join(ROOT, "supabase/functions/declutter-money/index.ts"), "utf8"));
    const ask = run.indexOf('if (!(await stillPayableNow("declutter", p.payout_id, p.seller_id, p.amount_cents))) continue;');
    expect(ask).toBeGreaterThan(-1);
    const fn = run.slice(run.indexOf("const stillPayableNow = async"), run.indexOf("const stillPayableNow = async") + 1500);
    expect(fn).toContain("await checkIdentityHold(admin, payeeId)");
    expect(fn).toMatch(/idHold\.kind === "waits"\) \{\s*out\.held\+\+;\s*await skipRow\(kind, payoutId, payeeId, amountCents, 60, "identity"/);
    // The rule is the shared one (not exempt, not verified), the same the Jobs payout claim reads.
    expect(body("payout_waits_on_identity")).toMatch(/NOT public\.identity_check_exempt\(p_user_id\)/);
    // lh-money-escrow 11-12: the queue keeps offering the row, so the run's identity wait reminds and alerts.
    expect(body("declutter_payouts_due")).not.toMatch(/payout_waits_on_identity/);
  });

  it("the seller's handover notice says 'Verify your ID to get paid $X' and links to the ID sheet", () => {
    const h = blankComments(body("declutter_complete_handover"));
    const at = h.indexOf("WHEN public.payout_waits_on_identity(o.seller_id) THEN");
    expect(at).toBeGreaterThan(-1);
    expect(h.slice(at, at + 200)).toContain("Verify your ID to get paid $%s.");
    // It comes before the "set up payouts" branch, so an unverified seller without an account hears the ID step first.
    expect(at).toBeLessThan(h.indexOf("'Set up payouts in Settings to get your $%s."));
    expect(h).toContain("'/declutter?tab=selling&verify_id=1&verify_reason=get_paid'");
  });

  it("Home: the to-do names the amount and opens the ID sheet; nothing when no money waits", async () => {
    const { deriveNeedsYouTodos } = await import("@/pages/home/homeDashboard/needsYouTodos");
    const ID_PAYOUT_TODO_ID = "declutter-id-payout";
    const base = { postedJobs: [], pendingApplicantCounts: {}, appliedApps: [], shopOrders: [], backout: new Map() };
    const todo = deriveNeedsYouTodos({ ...base, declutterIdPayoutCents: 2800 }).find((t) => t.id === ID_PAYOUT_TODO_ID);
    expect(todo?.title).toBe("Verify your ID to get paid $28.00");
    expect(todo?.to).toBe("/declutter?tab=selling&verify_id=1&verify_reason=get_paid");
    expect(todo?.section).toBe("declutter");
    expect(deriveNeedsYouTodos({ ...base, declutterIdPayoutCents: 0 }).some((t) => t.id === ID_PAYOUT_TODO_ID)).toBe(false);
  });

  it("only unsent payouts count toward what the ID check holds", async () => {
    const { payoutCentsWaiting } = await import("@/lib/declutter/idPayoutWait");
    expect(payoutCentsWaiting([
      { status: "pending", amount_cents: 2800 }, { status: "failed", amount_cents: 500 },
      { status: "succeeded", amount_cents: 9000 }, { status: "nothing_due", amount_cents: 0 }, { status: "held_for_review", amount_cents: 700 },
    ])).toBe(3300);
  });

  it("Selling: the prompt mounts with the money waiting and opens the sheet with the get_paid words", () => {
    const src = blankComments(readFileSync(join(ROOT, "src/components/declutter/SellerPayoutPrompt.tsx"), "utf8"));
    expect(src).toMatch(/<IdPayoutPrompt cents=\{waiting\.cents\} titles=\{waiting\.titles\} \/>/);
    expect(src).toContain('openIdentityCheckOrSay("get_paid")');
    expect(src).toContain("Verify your ID to get paid ${formatPrice(cents)}.");
    const sheet = readFileSync(join(ROOT, "src/components/identity/IdentityCheckSheet.tsx"), "utf8");
    expect(sheet).toMatch(/get_paid: "Your money is held safely until you verify your ID/);
    expect(sheet).toContain('params.get("verify_reason") === "get_paid" ? "get_paid"');
  });
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
