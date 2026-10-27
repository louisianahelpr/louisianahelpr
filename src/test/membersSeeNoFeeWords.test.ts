/**
 * CLASS GUARD: members never see a fee name, a fee number or fee maths.
 *
 * Owner decision, 2026-10-25 (the Helpr fee became 10% + 70c on new jobs):
 * "Members never see any fee number, fee name or fee maths. That covers the
 * app, the website and every email and notice. They see only the amount they
 * get or pay." The ONE fee a member may see is the one-time $2 account setup
 * fee. Admin screens keep the numbers. The Terms keep one general sentence
 * (Louisiana Helpr keeps a service fee from each Helpr payout), no numbers.
 *
 * Before this guard the app said "Helpr's fee (5% + 70¢) comes out of your
 * payout", "Platform fee", "less the card-processing fee", "Card processing"
 * on every tip, "(N% commission deducted)" in the Helpr's cancel notice, and
 * the database told a Helpr "minus the platform fee" when a job was cancelled.
 *
 * Inventory from source, three layers a member reads:
 *   1. every tracked .ts/.tsx under src/ (not tests, not src/test, not admin
 *      screens, not the generated Supabase types);
 *   2. every .ts/.tsx under supabase/functions (notices, emails, Stripe line
 *      items and receipts, error text a member reads);
 *   3. every SQL function the migrations leave in the database (effectiveDefs:
 *      the notices poster_cancel_job and friends write), rewrites included.
 * Each string literal, template literal and JSX text is read from the parsed
 * source (comments never count). A literal handed straight to console.*, an
 * ops/Slack alert or `new Error(...)` is staff text and is skipped; anything
 * else that names a fee is a finding unless it is in ALLOWED below, with the
 * reason it is not member copy. ALLOWED is exact both ways: an entry nobody
 * hits any more fails too, so the list can only shrink.
 *
 * @mutate src/pages/jobs/appliedJobCard/CancellationFeePill.tsx | for the cancelled job — on its way | as a cancellation fee — processing
 * @mutate src/components/TipCostBreakdown.tsx |         {row("You pay", q.chargeCents, true)} |         {row("Card processing", q.feeCents)}{row("You pay", q.chargeCents, true)}
 * @mutate supabase/functions/void-cancelled-payments/index.ts |           message: `You received $${formatPayoutDollars(helperPayout)} for "${job.title}", which was cancelled.`, |           message: `You received a $${formatPayoutDollars(helperPayout)} cancellation fee for "${job.title}" (${commissionPercent}% commission deducted).`,
 * @mutate supabase/functions/_shared/refundNotice.ts |     if (feeCents > 0) parts.push(`${refundDollars(feeCents)} for your Helpr's time`); |     if (feeCents > 0) parts.push(`${refundDollars(feeCents)} cancellation fee paid to your Helpr`);
 * @mutate supabase/migrations/20261025203540_notices_never_name_the_helpr_fee.sql | $q$'The amount for your Helpr''s time is now $%s.'$q$ | $q$'The cancellation fee is now $%s.'$q$
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { trackedFiles } from "./helpers/trackedFiles";
import { walkSource } from "./helpers/walkSource";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");

/** Fee words and fee maths a member may never read. The setup fee is not one of them. */
export const FEE_WORDS =
  /platform fees?|service fees?|helpr'?s? fees?|processing fees?|processor'?s fee|card fees?|card-processing|card processing|stripe'?s? (?:processing )?fees?|%\s*\+\s*\$|cancellation fees?|(?<![\w])commission(?![\w])/i;

/**
 * Callees whose string arguments are staff text (logs, ops alerts), never shown
 * to a member. Matched on the receiver where there is one (`console.*`,
 * `defects.record`), never on a bare generic name: `fail(status, message)`
 * returns its message TO the member in several edge functions (lh-silent-failure
 * review 2026-10-25, #7).
 */
const STAFF_CALLEE = /^(console|postSlackOpsAlert|postOpsAlert|insertAdminAlert|raiseAdminAlert|adminAlert|opsAlert|logStep|logError|captureException|captureMessage|reportError|defects\.record|Sentry\.capture\w+)$/;

const isTest = (f: string) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f) || f.startsWith("src/test/") || f.includes("/__tests__/") || f.includes("/_test/");
const isAdmin = (f: string) => /(^|\/)admin(\/|-)/.test(f) || /\/Admin[A-Z][^/]*\.tsx?$/.test(f);

/** Member-facing TS/TSX: src (tracked) and every edge function. */
export function memberSourceFiles(): string[] {
  const src = trackedFiles("src").filter((f) => /\.(ts|tsx)$/.test(f) && !isTest(f) && !isAdmin(f) && !f.startsWith("src/integrations/"));
  const edge = walkSource([resolve(ROOT, "supabase/functions")], [".ts", ".tsx"])
    .map((f) => f.slice(ROOT.length + 1))
    .filter((f) => !isTest(f) && !isAdmin(f));
  return [...src, ...edge].sort();
}

function calleeName(e: ts.Expression): string {
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) {
    if (ts.isIdentifier(e.expression) && e.expression.text === "console") return "console";
    return ts.isIdentifier(e.expression) ? `${e.expression.text}.${e.name.text}` : e.name.text;
  }
  return "";
}

/** Is this literal an argument (at any depth inside one call) of a staff-text call? */
function isStaffText(n: ts.Node): boolean {
  for (let p = n.parent; p; p = p.parent) {
    if (ts.isCallExpression(p) && STAFF_CALLEE.test(calleeName(p.expression))) return true;
    if (ts.isNewExpression(p) && ts.isIdentifier(p.expression) && p.expression.text === "Error") return true;
    if (ts.isFunctionLike(p) || ts.isSourceFile(p)) return false;
  }
  return false;
}

/** Every literal a member could read in one TS/TSX source, as "file::text" (templates join with ${}). */
export function feeLiteralsIn(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    let text: string | null = null;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isJsxText(n)) text = n.text;
    else if (ts.isTemplateExpression(n)) text = n.head.text + n.templateSpans.map((s) => "${}" + s.literal.text).join("");
    const inImport = n.parent && (ts.isImportDeclaration(n.parent) || ts.isExportDeclaration(n.parent) || ts.isExternalModuleReference(n.parent));
    if (text !== null && !inImport && FEE_WORDS.test(text) && !isStaffText(n)) out.push(`${file}::${text.replace(/\s+/g, " ").trim()}`);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** Every single-quoted literal in the SQL functions the database runs that names a fee, as "sql:<fn>::text". */
export function sqlFeeLiterals(): string[] {
  const out: string[] = [];
  for (const [name, def] of effectiveDefs(resolve(ROOT, "supabase/migrations"))) {
    const code = blankSqlComments(def.stmt);
    for (const m of code.matchAll(/'(?:[^']|'')*'/g)) {
      const lit = def.stmt.slice(m.index!, m.index! + m[0].length);
      if (FEE_WORDS.test(lit)) out.push(`sql:${name}::${lit.replace(/\s+/g, " ").trim()}`);
    }
  }
  return out;
}

export function allHits(): string[] {
  const hits = new Set<string>();
  for (const f of memberSourceFiles()) {
    for (const h of feeLiteralsIn(f, readFileSync(resolve(ROOT, f), "utf8"))) hits.add(h);
  }
  for (const h of sqlFeeLiterals()) hits.add(h);
  return [...hits].sort();
}

/**
 * The exact list of literals that name a fee and are NOT member copy, with why.
 * Exact both ways: remove an entry when its literal goes; never add member
 * copy here (say what they get or pay).
 */
// @two-way src/test/membersSeeNoFeeWords.test.ts:the allowlist is exact: no entry nobody hits any more
export const MEMBER_FEE_COPY_ALLOWED: Record<string, string> = {
  "sql:admin_alert_manual_close::'cancellation fee transfer failed'": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "sql:bill_helpr_fault_card_fee::'job %s: the Helpr ruled at fault was deleted while its full refund ran, so the %s-cent card fee the refund returned could not be billed: recover it by hand'": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "sql:block_user_and_settle::'\"%s\": the person who posted it blocked a committed crew member %s hours before the start. That member is owed a $%s cancellation fee (%s%% of their $%s share). Nothing was charged or paid automatically; settle it by hand.'": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "sql:declutter_apply_seller_fault::'\"%s\" was cancelled: on the Declutter order it was booked for, %s. It was not the poster''s choice, so no cancellation fee applies.'": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "sql:declutter_apply_seller_fault::'On your Declutter order, %s, so \"%s\" was cancelled. There is no cancellation fee, and anything you paid for it comes back in full (the one-time account setup fee excepted).'": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "sql:declutter_apply_seller_fault::'crew setup job %s of seller-fault Declutter refund %s was not cancelled (a crew''s fee ledger is per member): settle it by hand (no fee, card fee to the seller)'": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "sql:declutter_close_paid_order::'Your refund is on its way. The card fee is not refunded.'": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "sql:declutter_complete_handover::'This sale paid off the $%s card fee you owed, so there is nothing to send.'": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "sql:declutter_report_not_delivered::'You did not deliver a booked Declutter order. The buyer got everything back, delivery included; the card fee comes out of your next Declutter payout.'": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "sql:declutter_seller_cancel_delivery::'You cancelled a paid Declutter delivery. The buyer got everything back, delivery included; the card fee comes out of your next Declutter payout.'": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "src/components/declutter/SellerDeliveryOrder.tsx::Cancel this delivery? The buyer gets everything back, you get a Declutter strike, and the card fee comes out of your next payout.": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "src/components/declutter/SellerDeliveryOrder.tsx::Cancel this order? You get everything back except the card fee. You can cancel until 24 hours before the delivery.": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "src/components/declutter/SellerDeliveryOrder.tsx::Cancelled. Your refund is on its way, less the card fee.": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "sql:declutter_delivery_on_task_event::'No Helpr could deliver in time, so this sale is cancelled. Your delivery fee comes back in full and the rest of your payment minus the card fee.'": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "sql:declutter_delivery_raises_on_task_close::'A card fee comes out of your next payout'": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "sql:declutter_delivery_raises_on_task_close::'The $%s you added to the delivery pay is coming back to your card (its card fee is not refunded).'": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "sql:declutter_delivery_raises_on_task_close::'The buyer had raised the delivery pay, and the sale was cancelled on your side, so the $%s card fee on that raise comes out of your next Declutter payout.'": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "sql:declutter_delivery_raises_on_task_close::'seller-fault close of a raised delivery with no seller left to bill: the raise card fee is not booked'": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "sql:declutter_refund_paid_order::'You backed out of a sale after the buyer paid. The card fee for that payment comes out of your next Declutter payout.'": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "sql:declutter_refund_paid_order::'Your refund is on its way. The card fee is not refunded.'": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "sql:declutter_report_no_show::'You did not show up for a booked Declutter pickup. The buyer got everything back; the card fee comes out of your next Declutter payout.'": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "sql:declutter_seller_out_fee_notice::'A buyer paid for your items while your account can''t sell on Declutter, so they get every cent back. The $%s card fee for that payment comes out of your future Declutter payouts.'": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "sql:declutter_seller_out_fee_notice::'Card fee owed'": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "sql:declutter_setup_job_fee_debt::'Card fee added'": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "sql:declutter_setup_job_fee_debt::'The buyer''s Helpr setup job for a Declutter order refunded on you was refunded in full. Its $%s card fee is added to what you owe; it comes out of your next Declutter payout.'": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "sql:declutter_setup_job_fee_debt::'setup job %s: the seller of seller-fault Declutter refund %s is gone, so its %s-cent card fee could not be billed (the platform absorbs it)'": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "sql:poster_cancel_job::'crew_fee_exceeds_budget: the crew''s cancellation fee % is more than the budget % (job_id=%)'": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "sql:redeem_gift_card::'This job''s service fee is missing. Please try again.'": "poster-fee model: the jobs_poster_fee switch stays off and the poster never pays a fee (owner 2026-10-25), so this line never renders",
  "sql:shop_complete_handover::'$%s is on its way to your payout account ($%s card fee you owed was taken out).'": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "sql:shop_complete_handover::'This order paid off the $%s card fee you owed, so there is nothing to send.'": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "sql:shop_refund_sweep::'You never posted the ready photo for the order for %s, so the buyer was refunded in full. The $%s card fee comes out of your next payout, and it counts as a Shops strike.'": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "sql:shops_admin_refund_order::' The $%s card fee comes out of your next payout.'": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "sql:shops_admin_refund_order::', less the card-processing cost'": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "sql:shops_buyer_cancel_order::'$%s is on its way back to your card, less the card-processing cost%s. Card refunds usually show up in 5 to 10 business days.'": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "sql:shops_shop_cancel_order::'You cancelled an accepted order. The buyer gets everything back, the $%s card fee comes out of your next payout, and it counts as a Shops strike.'": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "src/components/declutter/DeclutterDeliveryViews.tsx::After the Helpr's fee (5% + 70¢). Paid when the buyer confirms it arrived, or 24 hours after you leave it. Take a photo at the pickup and at the drop-off.": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "src/components/declutter/DeclutterHandoverViews.tsx::Nothing to pay out: this sale covered a card fee you owed.": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "src/components/declutter/DeliveryRaisePanel.tsx::Card fee": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "src/components/declutter/DeliveryRaisePanel.tsx::The card fee is not refunded.": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "src/components/declutter/DeliveryRaisePanel.tsx::This is a second card payment, so the card fee is what the card company charges to take it.": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "src/components/postjob/CheckoutStep.tsx::(the job budget and service fee)": "poster-fee model: the jobs_poster_fee switch stays off and the poster never pays a fee (owner 2026-10-25), so this line never renders",
  "src/components/postjob/CheckoutStep.tsx::Service fee": "poster-fee model: the jobs_poster_fee switch stays off and the poster never pays a fee (owner 2026-10-25), so this line never renders",
  "src/components/postjob/CheckoutStep.tsx::Urgent bonus card fee": "poster-fee model: the jobs_poster_fee switch stays off and the poster never pays a fee (owner 2026-10-25), so this line never renders",
  "src/components/rentals/HomesBrowse.tsx::Homes listed by their verified owners. No commission. A title company or attorney handles the closing.": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "src/components/shops/ShopOrderCancel.tsx::The buyer gets everything back. The card fee comes out of your next payout, and it counts as a Shops strike (3 strikes pause Shops for you).": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "src/components/shops/ShopOrderCancel.tsx::less the card-processing cost and the sales tax on it. The shop is told not to make it.": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "src/components/shops/ShopOrderCard.tsx::+ service fee": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "src/components/shops/ShopOrderSheet.tsx::Service fee (5% + $0.70)": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "src/lib/declutter/errors.ts::That card fee amount isn't valid.": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "src/lib/posterFees.ts::Covers card processing": "poster-fee model: the jobs_poster_fee switch stays off and the poster never pays a fee (owner 2026-10-25), so this line never renders",
  "src/lib/posterJobFee.ts::5% + $0.70, covers card processing": "poster-fee model: the jobs_poster_fee switch stays off and the poster never pays a fee (owner 2026-10-25), so this line never renders",
  "src/lib/rentals/listingCopy.ts::Listed by its verified owner. No commission. A title company or attorney handles the closing.": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "src/lib/shops/handover.ts::(${} card fee you owed was taken out)": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "src/lib/shops/handover.ts::This order paid off ${} of card fees you owed, so nothing was sent.": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "src/lib/shops/orders.ts::After the shop accepts, you can cancel for a refund of the price until 24 hours before the ready date. The card fee is not refunded.": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "src/lib/shops/orders.ts::After the shop accepts, you can cancel for a refund of the price until your ready date begins, even if the shop marks your order ready sooner. The card fee is not refunded.": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "src/lib/shops/orders.ts::After the shop accepts, you can cancel for a refund of the price until your ready date begins, or until the shop marks your order ready if its rule says so. The card fee is not refunded.": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "src/lib/shops/orders.ts::After the shop accepts, you can cancel for a refund of the price until your ready date begins. If the shop marks your order ready sooner, free cancel ends then. The card fee is not refunded.": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "src/lib/shops/orders.ts::After the shop accepts, you can cancel for a refund of the price until your ready date begins. If the shop marks your order ready, free cancel ends then, but never before the day before your ready date. The card fee is not refunded.": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "src/lib/shops/orders.ts::Cancelled by you (refunded, less the card-processing cost)": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "src/pages/info/legal/TermsSection.tsx::${} Louisiana Helpr keeps a service fee from each Helpr payout; a Helpr always sees what they will take home before they apply.": "Terms of Service legal text: the owner kept one general service-fee sentence; the rest is legal terms or the paused Declutter terms",
  "src/pages/info/legal/TermsSection.tsx::Helpr's total liability for any claim is limited to the greater of the platform fees you paid us on the transaction at issue, or $100.": "Terms of Service legal text: the owner kept one general service-fee sentence; the rest is legal terms or the paused Declutter terms",
  "src/pages/info/legal/TermsSection.tsx::However the pickup is confirmed, you have 24 hours after pickup to ask for a refund. The seller can refund all of it (you get everything back except the card fee, and the item goes back to the seller), offer to refund part of it (exactly the amount offered), or decline (you can then report a problem, and Louisiana Helpr decides). If the seller doesn&apos;t answer within 24 hours, Louisiana Helpr decides.": "Terms of Service legal text: the owner kept one general service-fee sentence; the rest is legal terms or the paused Declutter terms",
  "src/pages/info/legal/TermsSection.tsx::Louisiana Helpr keeps a service fee from each Helpr's pay, deducted from the payout; it covers card processing. Every job shows the Helpr the amount they will take home before they apply, and a job keeps the fee in force when it was paid for. Every payout to a Helpr, for a job or a delivery, is rounded down to the whole dollar, and Louisiana Helpr keeps the cents left over. Tips are paid in full, and a card fee you owe for a refund you were at fault for comes off after the rounding, to the cent.": "Terms of Service legal text: the owner kept one general service-fee sentence; the rest is legal terms or the paused Declutter terms",
  "src/pages/info/legal/TermsSection.tsx::No plan changes the fee on a job: every Helpr pays the same service fee.": "Terms of Service legal text: the owner kept one general service-fee sentence; the rest is legal terms or the paused Declutter terms",
  "src/pages/info/legal/TermsSection.tsx::Service fee:": "Terms of Service legal text: the owner kept one general service-fee sentence; the rest is legal terms or the paused Declutter terms",
  "src/pages/info/legal/TermsSection.tsx::The poster pays the job price plus the service fee shown at checkout, before they pay.": "Terms of Service legal text: the owner kept one general service-fee sentence; the rest is legal terms or the paused Declutter terms",
  "src/pages/info/legal/TermsSection.tsx::You pay the agreed job price plus any applicable sales tax (and, on your first paid job, the one-time account setup fee). Louisiana taxes only enumerated services (LA R.S. 47:301(14)), so most jobs carry no sales tax at all; where it does apply it is charged on the labor line only, never on Helpr's fees. Workers are": "Terms of Service legal text: the owner kept one general service-fee sentence; the rest is legal terms or the paused Declutter terms",
  "src/pages/info/legal/TermsSection.tsx::after you pay, you can book a Helpr to put an item together, hang it or set it up. It is an ordinary Helpr job under the normal job rules and fees, paid separately. If the sale is refunded because the seller failed, that job is cancelled with no cancellation fee, you get the card fee back, and the seller owes it.": "Terms of Service legal text: the owner kept one general service-fee sentence; the rest is legal terms or the paused Declutter terms",
  "src/pages/info/legal/TermsSection.tsx::and receive the whole item price, less any card fee they owe from a sale they cancelled. We hold the payment through Stripe until the sale is final.": "Terms of Service legal text: the owner kept one general service-fee sentence; the rest is legal terms or the paused Declutter terms",
  "src/pages/info/legal/TermsSection.tsx::everything back; the seller pays the card fee and gets a strike. The same full refund applies if the seller can no longer sell when you pay.": "Terms of Service legal text: the owner kept one general service-fee sentence; the rest is legal terms or the paused Declutter terms",
  "src/pages/info/legal/TermsSection.tsx::minimum bonus, added by the poster for priority placement. It is part of the job price the poster pays and goes to the Helpr (split among the crew on a group job), with the service fee above taken from each Helpr's share of the job price, bonus included.": "Terms of Service legal text: the owner kept one general service-fee sentence; the rest is legal terms or the paused Declutter terms",
  "src/pages/info/legal/TermsSection.tsx::the delivery fee in full and the rest minus the card fee; no strike.": "Terms of Service legal text: the owner kept one general service-fee sentence; the rest is legal terms or the paused Declutter terms",
  "src/pages/info/legal/TermsSection.tsx::the delivery fee minus the same service fee as jobs, plus any raise in full, paid in whole dollars rounded down; Louisiana Helpr keeps the leftover cents.": "Terms of Service legal text: the owner kept one general service-fee sentence; the rest is legal terms or the paused Declutter terms",
  "src/pages/info/legal/TermsSection.tsx::the item price plus a buyer&apos;s fee of 5% of the item total + $0.70, once per checkout (it includes card processing). With seller delivery, the buyer&apos;s fee is worked out on the items and the seller&apos;s delivery rate together. A Helpr delivery fee carries no buyer&apos;s fee. You see one total before you pay.": "Terms of Service legal text: the owner kept one general service-fee sentence; the rest is legal terms or the paused Declutter terms",
  "src/pages/info/legal/TermsSection.tsx::the one-time account setup fee and the service fee above.": "Terms of Service legal text: the owner kept one general service-fee sentence; the rest is legal terms or the paused Declutter terms",
  "src/pages/info/legal/TermsSection.tsx::the payment back minus the card fee.": "Terms of Service legal text: the owner kept one general service-fee sentence; the rest is legal terms or the paused Declutter terms",
  "src/pages/info/legal/TermsSection.tsx::while you wait, you may raise the delivery pay, at least $5 at a time in whole dollars, at most $150 in total for one delivery, and not in the last hour of the 48 hours. You pay the raise plus its card fee, and the Helpr gets the whole raise. A refunded raise comes back with its card fee unless you cancel for your own reason; if the seller&apos;s fault cancels a raised delivery, the seller pays the raise&apos;s card fee.": "Terms of Service legal text: the owner kept one general service-fee sentence; the rest is legal terms or the paused Declutter terms",
  "src/pages/info/legal/TermsSection.tsx::you may cancel a paid seller delivery until 24 hours before the slot and get everything back except the card fee; after that, report a problem. A seller who cancels a paid delivery refunds you in full, gets a Declutter strike and pays the card fee.": "Terms of Service legal text: the owner kept one general service-fee sentence; the rest is legal terms or the paused Declutter terms",
  "supabase/functions/_shared/accountPurge.ts::cancellation fee ${}": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "supabase/functions/_shared/chargebackClawback.ts::Card dispute won — re-pay ledger row has an UNKNOWN platform fee": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "supabase/functions/_shared/crewBlockFeeRead.ts::A crew member blocked by the person who posted this job is owed a $${} cancellation fee from this job's payment, so it can't be refunded in full. No money was moved. Cancel the job instead (everything but that fee goes back to whoever paid), or refund a partial amount.": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "supabase/functions/_shared/crewBlockFeeRead.ts::A crew member blocked by the person who posted this job is owed a $${} cancellation fee from this job's payment, so this dispute can't be refunded in full. No money was moved. Decide the dispute for each crew member instead.": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "supabase/functions/_shared/crewBlockFees.ts::nothing left after commission": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "supabase/functions/_shared/posterFees.ts::Covers card processing": "poster-fee model: the jobs_poster_fee switch stays off and the poster never pays a fee (owner 2026-10-25), so this line never renders",
  "supabase/functions/_shared/posterJobFee.ts::5% + $0.70, covers card processing": "poster-fee model: the jobs_poster_fee switch stays off and the poster never pays a fee (owner 2026-10-25), so this line never renders",
  "supabase/functions/_shared/refundReason.ts::${} cancellation fee paid to the Helpr": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "supabase/functions/_shared/refundReason.ts::${} card processing fee": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "supabase/functions/_shared/refundReason.ts::${} service fee": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "supabase/functions/create-payment/index.ts::${}% + $0.70 for Pay in 4, covers payment processing": "poster-fee model: the jobs_poster_fee switch stays off and the poster never pays a fee (owner 2026-10-25), so this line never renders",
  "supabase/functions/create-payment/index.ts::Remaining balance after applying your gift card, including the service fee (${}). Funds release once both parties confirm completion.": "poster-fee model: the jobs_poster_fee switch stays off and the poster never pays a fee (owner 2026-10-25), so this line never renders",
  "supabase/functions/create-payment/index.ts::Service fee": "poster-fee model: the jobs_poster_fee switch stays off and the poster never pays a fee (owner 2026-10-25), so this line never renders",
  "supabase/functions/create-payment/index.ts::This job has a Helpr-at-fault ruling, so refund it with \"Helpr at fault\" (that bills the Helpr the card fee). No money was moved.": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "supabase/functions/create-payment/index.ts::dispute refund (minus non-refundable Stripe processing fee and the kept $2 setup fee)": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "supabase/functions/create-payment/index.ts::dispute refund (minus non-refundable Stripe processing fee)": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "supabase/functions/create-payment/index.ts::dispute refund, Helpr at fault (card fee returned and billed to the Helpr)": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "supabase/functions/create-payment/index.ts::dispute refund, Helpr at fault (card fee returned and billed to the Helpr; the $2 setup fee kept)": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "supabase/functions/create-payment/index.ts::full refund less the card processing fee": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "supabase/functions/create-payment/index.ts::full refund less the card processing fee and the kept $2 setup fee": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "supabase/functions/create-payment/index.ts::the $${} card processing fee and the one-time $${} setup fee are kept": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "supabase/functions/create-payment/index.ts::the $${} card processing fee is kept": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "supabase/functions/declutter-checkout/index.ts::Card fee": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "supabase/functions/execute-dispute-split/index.ts::Helpr-fault card fee read failed": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "supabase/functions/execute-dispute-split/index.ts::dispute split — poster's share (minus non-refundable Stripe processing fee)": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "supabase/functions/money-reconciliation/index.ts::A SETTLED payout_transfer recorded a commission that differs from what the Helpr's LIVE subscription tier would charge — the discount was not applied to money that actually moved. Graded against the transfer ledger, never against jobs.helper_fee_percent, which is a global escrow-time stamp and is expected to differ from the ladder.": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "supabase/functions/money-reconciliation/index.ts::A cancellation_fee_transfers row has been 'pending' or 'failed' for more than ${}h — the Helpr is still owed their cancellation fee. void-cancelled-payments retries it hourly; read failure_reason.": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "supabase/functions/money-reconciliation/index.ts::A cancelled, undisputed job's charge is captured at Stripe and the platform kept more than the cancellation fee plus the non-refundable service fee (floored at Stripe's real processing cost) plus a first job's kept $2 setup fee (Q1674) — the same ceiling void-cancelled-payments and cancel_escrow refund against. The poster was not given back money the DB says they were.": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "supabase/functions/money-reconciliation/index.ts::Stored jobs.cancellation_fee disagrees with computeCancellationFee() — the row lies to the Helpr's fee pill, admin revenue, and reliability record even though escrow settled correctly.": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "supabase/functions/money-reconciliation/index.ts::The settled payout transfers of a group job (payout + commission) add up to more than its budget plus urgent fee — the crew was paid more than the escrow held.": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "supabase/functions/money-reconciliation/index.ts::cancellation fees capped at the card (Q2000, gift uncollectable): ${}": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "supabase/functions/money-reconciliation/index.ts::capped cancellation fees not checked, none accepted: ${}": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "supabase/functions/money-reconciliation/index.ts::payout hold read failed, no held cancellation fee exempted: ${}": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "supabase/functions/process-scheduled-payouts/index.ts::Helpr fee tier read ${}: ${}": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "supabase/functions/process-scheduled-payouts/index.ts::crew dispute: the refunded members' shares (and any unfilled slots), with that share of the service fee and tax": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "supabase/functions/process-scheduled-payouts/index.ts::under-filled crew: the unfilled slots' shares, with that share of the service fee and tax": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "supabase/functions/shop-checkout/index.ts::Service fee (5% + $0.70)": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "supabase/functions/void-cancelled-payments/index.ts::Cancellation fee transfer failed": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "supabase/functions/void-cancelled-payments/index.ts::Declutter seller backed out: full refund, card fee billed to the seller${}": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "supabase/functions/void-cancelled-payments/index.ts::Failed to transfer $${} cancellation fee to Helpr for job ${}. Error: ${}": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "supabase/functions/void-cancelled-payments/index.ts::a crew member's share of the cancellation fee: their account was deleted, so it goes back to the person who posted it": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "supabase/functions/void-cancelled-payments/index.ts::nothing left after commission": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
};

describe("members see no fee words (owner 2026-10-25)", () => {
  const hits = allHits();
  const allowed = new Set(Object.keys(MEMBER_FEE_COPY_ALLOWED));

  it("reads the whole inventory (src, edge functions and the SQL functions)", () => {
    expect(memberSourceFiles().filter((f) => f.startsWith("src/")).length).toBeGreaterThan(1200);
    expect(memberSourceFiles().filter((f) => f.startsWith("supabase/functions/")).length).toBeGreaterThan(250);
    expect(effectiveDefs(resolve(ROOT, "supabase/migrations")).size).toBeGreaterThan(1000);
    // The allowlist is not empty because the scan is blind: it finds staff text.
    expect(hits.length).toBeGreaterThan(50);
  });

  it("every literal that names a fee is admin, staff, paused or dormant text with a reason", () => {
    const unlisted = hits.filter((h) => !allowed.has(h));
    expect(unlisted, `member copy names a fee: say what they get or pay instead (or, for staff text, add it to the allowlist with why)`).toEqual([]);
  });

  it("the allowlist is exact: no entry nobody hits any more", () => {
    const hitSet = new Set(hits);
    expect([...allowed].filter((a) => !hitSet.has(a)).sort()).toEqual([]);
  });

  it("the scanner sees a fee in member copy and skips staff text (fixture)", () => {
    const src = [
      `const a = "You received a $5 cancellation fee";`,
      "const b = `${pct}% + $${cents}`;",
      `const c = <p>Platform fee</p>;`,
      `console.error("platform fee read failed");`,
      `throw new Error("card fee missing");`,
      `throw new PublicError("Your card fee is due");`,
      `const d = "one-time $2 account setup fee";`,
      `// a comment about the platform fee`,
    ].join("\n");
    expect(feeLiteralsIn("x.tsx", src)).toEqual([
      "x.tsx::You received a $5 cancellation fee",
      "x.tsx::${}% + $${}",
      "x.tsx::Platform fee",
      "x.tsx::Your card fee is due",
    ]);
  });
});
