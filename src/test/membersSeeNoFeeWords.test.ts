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
 *
 * Declutter (owner re-confirmed 2026-10-27 before its 2026-10-28 launch, issue #3672): FEE_WORDS missed
 * "buyer's fee", "seller's fee", "delivery fee" and "5% + 70¢" (it only knew "% + $"), so most Declutter copy
 * never reached the allowlist. They are fee words now, in every quote form a source holds them in (', ’,
 * &apos; and SQL's ''), and Declutter has no allowlist entry left but three ops-ledger lines.
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx | If they accept, you have 24 hours to check out. Nothing is charged until you pay. | If they accept, you have 24 hours to check out. At checkout you pay the price plus a buyer's fee of 5% + 70¢.
 * @mutate src/components/declutter/DeclutterDeliverExplainer.tsx | your pay before you take it, and tips are all yours. | your pay before you take it: the delivery fee minus 5% + 70¢.
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts | the raise comes back with what you paid for delivery.` | the raise comes back with your delivery fee.`
 * @mutate supabase/migrations/20261027172503_declutter_notices_name_no_fee.sql | $q$'Amount owed'$q$ | $q$'Card fee owed'$q$
 * @mutate supabase/migrations/20261027172503_declutter_notices_name_no_fee.sql | $q$is coming back to your card.$q$, 'g'), | $q$is coming back to your card. Your buyer''s fee is not refunded.$q$, 'g'),
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
  /platform fees?|service fees?|helpr'?s? fees?|buyer(?:''|'|&apos;|’)?s? fees?|seller(?:''|'|&apos;|’)?s? fees?|delivery[- ]fees?|processing fees?|processor'?s fee|card fees?|card-processing|card processing|stripe'?s? (?:processing )?fees?|%\s*\+\s*\$|%\s*\+\s*(?:\d+|\$\{\})\s*(?:¢|c\b|cents?\b)|cancellation fees?|(?<![\w])commission(?![\w])/i;

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
  "src/components/declutter/DeclutterTradeViews.tsx::Includes a small Louisiana Helpr service fee.": "owner decision 2026-10-28 (#20, \"Words only\"): the checkout total says it includes a service fee, with no name of a rate and no number",
  "src/pages/profile/Receipts.tsx::Includes a small Louisiana Helpr service fee.": "owner decision 2026-10-28 (#20, \"Words only\"; DB-13, audit 2026-10-30): a Declutter receipt's total says it includes the same service fee the checkout total said, with no name of a rate and no number",
  "src/components/TipCostBreakdown.tsx::Includes a small Louisiana Helpr service fee.": "owner decision 2026-10-28 (#20, \"Words only\"; F30, lead): the tip's You pay total says it includes a service fee, with no name of a rate and no number",
  "src/components/reviewPanel/ReviewForm.tsx::Your Helpr gets the whole tip. Includes a small Louisiana Helpr service fee. Most people tip 10–15% for great work.": "owner decision 2026-10-28 (#20, \"Words only\"; F30, lead): the tip prompt says a service fee is included, with no number (10–15% is a tip suggestion, not a fee)",
  "sql:admin_alert_manual_close::'cancellation fee transfer failed'": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "sql:bill_helpr_fault_card_fee::'job %s: the Helpr ruled at fault was deleted while its full refund ran, so the %s-cent card fee the refund returned could not be billed: recover it by hand'": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "sql:block_user_and_settle::'\"%s\": the person who posted it blocked a committed crew member %s hours before the start. That member is owed a $%s cancellation fee (%s%% of their $%s share). Nothing was charged or paid automatically; settle it by hand.'": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "sql:declutter_apply_seller_fault::'crew setup job %s of seller-fault Declutter refund %s was not cancelled (a crew''s fee ledger is per member): settle it by hand (no fee, card fee to the seller)'": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "sql:declutter_delivery_raises_on_task_close::'seller-fault close of a raised delivery with no seller left to bill: the raise card fee is not booked'": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "sql:declutter_setup_job_fee_debt::'setup job %s: the seller of seller-fault Declutter refund %s is gone, so its %s-cent card fee could not be billed (the platform absorbs it)'": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "sql:poster_cancel_job::'crew_fee_exceeds_budget: the crew''s cancellation fee % is more than the budget % (job_id=%)'": "staff text: an admin alert, admin tool reply, ledger reason or log line no member reads",
  "sql:redeem_gift_card::'This job''s service fee is missing. Please try again.'": "poster-fee model: the jobs_poster_fee switch stays off and the poster never pays a fee (owner 2026-10-25), so this line never renders",
  "sql:shop_complete_handover::'$%s is on its way to your payout account ($%s card fee you owed was taken out).'": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "sql:shop_complete_handover::'This order paid off the $%s card fee you owed, so there is nothing to send.'": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "sql:shop_refund_sweep::'You never posted the ready photo for the order for %s, so the buyer was refunded in full. The $%s card fee comes out of your next payout, and it counts as a Shops strike.'": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "sql:shops_admin_refund_order::' The $%s card fee comes out of your next payout.'": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "sql:shops_admin_refund_order::', less the card-processing cost'": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "sql:shops_buyer_cancel_order::'$%s is on its way back to your card, less the card-processing cost%s. Card refunds usually show up in 5 to 10 business days.'": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "sql:shops_shop_cancel_order::'You cancelled an accepted order. The buyer gets everything back, the $%s card fee comes out of your next payout, and it counts as a Shops strike.'": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "src/components/postjob/CheckoutStep.tsx::(the job budget and service fee)": "poster-fee model: the jobs_poster_fee switch stays off and the poster never pays a fee (owner 2026-10-25), so this line never renders",
  "src/components/postjob/CheckoutStep.tsx::Service fee": "poster-fee model: the jobs_poster_fee switch stays off and the poster never pays a fee (owner 2026-10-25), so this line never renders",
  "src/components/postjob/CheckoutStep.tsx::Urgent bonus card fee": "poster-fee model: the jobs_poster_fee switch stays off and the poster never pays a fee (owner 2026-10-25), so this line never renders",
  "src/components/rentals/HomesBrowse.tsx::Homes listed by their verified owners. No commission. A title company or attorney handles the closing.": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "src/components/shops/ShopOrderCancel.tsx::The buyer gets everything back. The card fee comes out of your next payout, and it counts as a Shops strike (3 strikes pause Shops for you).": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "src/components/shops/ShopOrderCancel.tsx::less the card-processing cost and the sales tax on it. The shop is told not to make it.": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "src/components/shops/ShopOrderCard.tsx::+ service fee": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
  "src/components/shops/ShopOrderSheet.tsx::Service fee (5% + $0.70)": "Declutter, Shops or Rentals: paused, testers only; not reworded (owner 2026-10-25), listed in the fee-copy report",
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
  "src/pages/info/legal/TermsSection.tsx::Louisiana Helpr keeps a service fee from each Helpr's pay, deducted from the payout; it covers card processing. Every job shows the Helpr the amount they will take home before they apply, and a job keeps the fee in force when it was paid for. Every payout to a Helpr, for a job or a delivery, is rounded down to the whole dollar, and Louisiana Helpr keeps the cents left over. Tips are paid in full, and a card fee you owe for a refund you were at fault for comes off after the rounding, to the cent.": "Terms of Service legal text: the owner kept one general service-fee sentence; the rest is legal terms or the paused Declutter terms",
  "src/pages/info/legal/TermsSection.tsx::post what you&apos;re looking for and the most you&apos;d pay for the item, before our buyer&apos;s fee; a post lasts 30 days unless you close it. Sellers near you can always see it, with your first name and last initial and about how far away, never your address, and a seller can answer with an offer at or under your price.": "Terms of Service legal text: the Wanted paragraph says the price is before the buyer's fee (lead approved the wording, b42)",
  "src/pages/info/legal/TermsSection.tsx::No plan changes the fee on a job: every Helpr pays the same service fee.": "Terms of Service legal text: the owner kept one general service-fee sentence; the rest is legal terms or the paused Declutter terms",
  "src/pages/info/legal/TermsSection.tsx::Service fee:": "Terms of Service legal text: the owner kept one general service-fee sentence; the rest is legal terms or the paused Declutter terms",
  "src/pages/info/legal/TermsSection.tsx::The poster pays the job price plus the service fee shown at checkout, before they pay.": "Terms of Service legal text: the owner kept one general service-fee sentence; the rest is legal terms or the paused Declutter terms",
  "src/pages/info/legal/TermsSection.tsx::You pay the agreed job price plus any applicable sales tax (and, on your first paid job, the one-time account setup fee). Louisiana taxes only enumerated services (LA R.S. 47:301(14)), so most jobs carry no sales tax at all; where it does apply it is charged on the labor line only, never on Helpr's fees. Workers are": "Terms of Service legal text: the owner kept one general service-fee sentence; the rest is legal terms or the paused Declutter terms",
  "src/pages/info/legal/TermsSection.tsx::minimum bonus, added by the poster for priority placement. It is part of the job price the poster pays and goes to the Helpr (split among the crew on a group job), with the service fee above taken from each Helpr's share of the job price, bonus included.": "Terms of Service legal text: the owner kept one general service-fee sentence; the rest is legal terms or the paused Declutter terms",
  "src/pages/info/legal/TermsSection.tsx::the item price plus a buyer&apos;s fee, once per checkout, which covers running Declutter and card processing. You see one total before you pay, delivery included.": "Terms of Service legal text: the owner kept one general service-fee sentence; the rest is legal terms or the paused Declutter terms",
  "src/pages/info/legal/TermsSection.tsx::the one-time account setup fee and the service fee above.": "Terms of Service legal text: the owner kept one general service-fee sentence; the rest is legal terms or the paused Declutter terms",
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
  "supabase/functions/void-cancelled-payments/index.ts::a cancellation fee": "staff text: holdUnlessPayable's `what`, read only by its console line and its ops alert (_shared/livePayoutHold.ts); no member reads it",
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
      `const e = "Buyer's fee (5% + 70¢)";`,
      `const f = "5% + 70 cents, once per seller";`,
      `const g = <p>the buyer&apos;s fee is kept</p>;`,
      `const h = "Your delivery fee comes back";`,
      `const i = "The seller’s fee";`,
      `const j = "Delivery $24";`,
      `const k = "The item price drops 5% each evening";`,
    ].join("\n");
    expect(feeLiteralsIn("x.tsx", src)).toEqual([
      "x.tsx::You received a $5 cancellation fee",
      "x.tsx::${}% + $${}",
      "x.tsx::Platform fee",
      "x.tsx::Your card fee is due",
      "x.tsx::Buyer's fee (5% + 70¢)",
      "x.tsx::5% + 70 cents, once per seller",
      "x.tsx::the buyer&apos;s fee is kept",
      "x.tsx::Your delivery fee comes back",
      "x.tsx::The seller’s fee",
    ]);
    // SQL holds a quote doubled.
    expect(FEE_WORDS.test("'The item price was refunded; the buyer''s fee was not.'")).toBe(true);
    expect(FEE_WORDS.test("'The item price was refunded.'")).toBe(false);
  });
});
