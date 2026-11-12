// No test fixture may describe a row the database would reject.
//
// THE FAILURE THIS PREVENTS
// -------------------------
// Every Playwright spec CI runs talks to a mock: 28 of the 36 specs install
// `page.route()` stubs, and the CI invocation is `--project=happy-path`, whose
// entire testDir is mocked. A mock accepts any string. So a fixture describing
// an impossible row is not merely wrong — it is UNFALSIFIABLE, and every
// assertion built on it tests a state the product can never be in.
//
// This has already happened twice, in the same shape both times:
//   * `payment_status: "paid"` on six job fixtures. `jobs_payment_status_check`
//     has never admitted "paid". It survived for months because the code under
//     test ignored the column; the day `payment_status` started deciding what
//     counts as the helper's money, a passing E2E went red for a defect that
//     had been sitting in the fixture all along.
//   * `pricing_mode: "fixed"` on EVERY seeded job (JOB_BASE in seedData.ts,
//     plus stateMatrix.ts and three specs). `jobs_pricing_mode_check` admits
//     exactly one value, `'set_price'` — bidding was removed in
//     20260827210851_drop_bidding_machinery.sql and the constraint narrowed
//     to a single literal. Found by this test on its first run, 2026-09-06.
//
// WHY TYPESCRIPT CANNOT DO THIS
// -----------------------------
// `pricing_mode` and `payment_status` are plain `text` columns. The generated
// `Insert` type types them `string`. `"fixed"` and `"paid"` typecheck perfectly
// and always will. The CHECK constraint is the only thing in the system that
// knows, and it is written in SQL. That is the whole gap this closes.
//
// HOW BOTH SIDES ARE DERIVED FROM THE WORLD
// -----------------------------------------
//   constraints  ← supabase/migrations/*.sql, replayed in order
//   table shapes ← src/integrations/supabase/types.ts (generated from prod)
//   fixtures     ← walking e2e/ and src/test/
// Nothing here is a hand-kept list of what to check, because a list that is
// both the input and the definition of correctness cannot fail for a missing
// member — a mistake this repo has made three times. The only hand-written
// list is ACKNOWLEDGED below, and that one is supposed to be hand-written: it
// is the diff where someone says out loud that a fixture is impossible and why
// it stays that way.
//
// RELATIONSHIP TO fixturePaymentStatus.test.ts
// --------------------------------------------
// That test does this for ONE column and keeps a heuristic this one does not:
// it flags a `payment_status` sitting next to a jobs-only `status` even when
// the literal carries no column unique to `jobs`. Both are cheap; both stay.
// Proven able to fail 2026-09-20: putting the historic impossible value back
// into JOB_BASE turns it red (jobs_pricing_mode_check admits only set_price).
// @mutate e2e/happy-path/seedData.ts | pricing_mode: "set_price", | pricing_mode: "fixed",
// @mutate src/test/helpers/schemaConstraints.ts | (nul && nul[1] !== rec.column ? null : rec) | (rec)
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { walkSource, readSource } from "./helpers/walkSource";
import {
  extractConstraints,
  schemaTables,
  schemaRequired,
  distinctiveColumns,
  objectLiterals,
  checkRow,
  literalReader,
  balanced,
  type Violation,
} from "./helpers/schemaConstraints";

const REPO = resolve(__dirname, "../..");

/**
 * `const NAME = { … }` / `= [ … ]`, as source text. Deliberately textual: the
 * alternative is importing e2e/happy-path/seedData.ts from src/, which would
 * pull an `e2e` file into the `src` composite project and break `tsc -b`.
 */
function constValue(src: string, name: string, depth = 0): string | null {
  const decl = new RegExp(`\\bconst\\s+${name}\\b[^=\\n]*=\\s*`).exec(src);
  if (!decl) return null;
  const start = decl.index + decl[0].length;
  if (src[start] === "{") return balanced(src, start, "{", "}");
  if (src[start] === "[") return balanced(src, start, "[", "]");
  // `SEED_JOBS = JOB_SEEDS.map(j => ({ ...JOB_BASE, ...j }))` — follow one hop
  // to the array the rows actually live in. Without this the entire jobs seed
  // set resolves to nothing and the pass reports a confident, empty green.
  const hop = /^([A-Za-z_$][\w$]*)\s*\.\s*(?:map|filter|slice|concat)\b/.exec(src.slice(start));
  if (hop && depth < 3 && hop[1] !== name) return constValue(src, hop[1], depth + 1);
  return null;
}

/** Top-level `{ … }` groups inside an array literal's text. */
function rowsOf(arrayText: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < arrayText.length; i++) {
    if (arrayText[i] !== "{") continue;
    const inner = balanced(arrayText, i, "{", "}");
    if (inner === null) break;
    out.push(`{${inner}}`);
    i += inner.length + 1; // siblings only — nested objects are fields, not rows
  }
  return out;
}

/**
 * Fixtures that ARE impossible and stay that way, each with the reason.
 *
 * Keyed by "<file>: <table>.<column>". Adding a line turns a silent
 * impossibility into a reviewed one; it must never be used to quiet a fixture
 * that could simply be corrected.
 */
const ACKNOWLEDGED: Record<string, string> = {
  "src/test/declutterTradesClient.test.tsx: declutter_items.status":
    "Not a declutter_items row: the F359f fixture is a fetchMyTrades() trade row (id, status, respond_by, my_side, " +
    "item, offered, my_line_status, talk_order_id), and 'open' is a live declutter_trades status. The shape match " +
    "picks declutter_items because the trade row has no table of its own in the generated types (lead, 2026-11-10).",
  "src/test/edge/create-payment.test.ts: jobs.budget":
    "The '$0 refund' scenario models a capture consumed entirely by the service " +
    "fee, seeded as budget 0 + customer_fee_amount 2. `jobs_budget_range` has " +
    "never admitted a budget below 10, so no such job can exist in prod — which " +
    "means either that branch is unreachable or the scenario models it wrongly. " +
    "Reshaping the numbers changes the arithmetic under test in an escrow-refund " +
    "path, so it belongs to the money lane, not to a fixture sweep. Filed rather " +
    "than papered over.",
};

const constraints = extractConstraints();
const schema = schemaTables();
const distinctive = distinctiveColumns(schema);
// Column names that live on one table but are ALSO the everyday key of
// non-row objects, so they never identify a row on their own. `state`
// (job_card_holds, Q2399 20261027185146) is Playwright's waitFor({ state:
// "visible" }) and every RPC answer `{ state: "accepted" }`; a hold row is
// still attributed by its own columns (capturing_from, notified_state, ...). `step` (needs_you_reminder_sends,
// A3-85 20261102002011, typed 11-01) is every wizard's and job card's `{ step: "confirm" }`; a reminder-send row is
// attributed by its own columns (ref_id, rung, deadline).
// `gift_card_id` (declutter_orders, Q2106 20261105030604, its only table column) is the everyday key of every job
// payment's Stripe metadata and RPC answer (`{ gift_card_id: "gift-1" }` in fundedJobPaymentFailed / release-payout);
// a Declutter order row is still attributed by its own columns (gift_cents, delivery_cents, handover, ...).
// `language` (profiles, F260q 20261111213927) is every pg_proc fixture's `{ language: "plpgsql" }` (raceClassGuard);
// a profile row is still attributed by its own columns (full_name, user_id, ...).
const NOT_A_ROW_MARKER = ["state", "step", "gift_card_id", "language"];
for (const k of NOT_A_ROW_MARKER) distinctive.delete(k);

// ---------------------------------------------------------------------------
// The grader must be capable of failing before its silence means anything.
// ---------------------------------------------------------------------------
describe("the constraint reader really read the constraints", () => {
  it("recovers a meaningful number of them, on the tables that matter", () => {
    const total = [...constraints.values()].reduce((n, m) => n + m.size, 0);
    // Prod holds 81 CHECK constraints in `public` (pg_constraint, 2026-09-06);
    // this parser deliberately skips conditional and multi-column ones. A
    // sudden collapse below this floor means the parser broke, not that the
    // database relaxed.
    expect(total).toBeGreaterThanOrEqual(60);

    const jobs = constraints.get("jobs")!;
    expect(jobs.get("jobs_payment_status_check")).toMatchObject({
      kind: "enum",
      column: "payment_status",
    });
    // The exact live value list, so a mis-parse that drops entries is caught.
    expect((jobs.get("jobs_payment_status_check") as { values: string[] }).values).toEqual([
      "unpaid", "escrow", "payout_pending", "released", "refunded",
      "cancelled", "abandoned", "failed", "chargeback", "cancelling",
      // Q2399 (20261027185146): the poster's card held, charged at the hire.
      "held",
    ]);
    expect((jobs.get("jobs_pricing_mode_check") as { values: string[] }).values).toEqual(["set_price"]);
    // 5000 until Q202 (2026-09-23); the one shared constant is jobBudgetLimits.ts.
    expect(jobs.get("jobs_budget_range")).toMatchObject({ kind: "range", min: 10, max: 1000 });

    // Replacement semantics: notifications.type was defined inline with 7
    // values, later re-added with 18, with 25 by 20261028162048, 26 by 20261030170443 and 29 by 20261108201153 (the
    // seven declutter_* kinds) and 30 by 20261112061000 (admin_activity). Only the newest one may survive.
    const notifType = constraints.get("notifications")!.get("notifications_type_check") as {
      values: string[];
    };
    expect(notifType.values).toContain("admin_alert");
    expect(notifType.values).toContain("declutter_wanted");
    expect(notifType.values).toContain("shops_orders");
    expect(notifType.values).toContain("admin_activity");
    expect(notifType.values.length).toBe(30);

    // Defined inline on a continuation line inside CREATE TABLE, and via
    // `ALTER TABLE … ADD COLUMN … CHECK` respectively — two shapes an earlier
    // draft of this parser missed entirely.
    expect(constraints.get("disputes")!.has("disputes_status_check")).toBe(true);
    expect(constraints.get("applications")!.has("applications_stake_status_check")).toBe(true);
  });

  it("refuses to guess at conditional and multi-column constraints", () => {
    // Reading `marketing_content_instagram_needs_media` as "status must be
    // draft or cancelled" would red every published marketing row. Reading
    // `profiles_auto_tip_valid` as "auto_tip_value is 1..50" would red every
    // fixed-mode tip up to 500. Both are live; both must be skipped.
    expect(constraints.get("marketing_content")?.has("marketing_content_instagram_needs_media")).toBeFalsy();
    expect(constraints.get("profiles")?.has("profiles_auto_tip_valid")).toBeFalsy();
    // `captured_at IS NULL OR status IN (...)` constrains status only once captured.
    expect(constraints.get("shop_orders")?.has("shop_orders_captured_is_accepted")).toBeFalsy();
  });

  it("reads the table shapes from the generated types", () => {
    // Nor does `state` (only job_card_holds has it, but tests use it as a US state, a workflow state, a locator state).
    expect(distinctive.has("state")).toBe(false);
    expect(distinctive.get("capturing_from")).toBe("job_card_holds");
    expect(schema.size).toBeGreaterThan(50);
    expect(schema.get("jobs")?.has("payment_status")).toBe(true);
    expect(schema.get("notifications")?.has("type")).toBe(true);
    // `status` is shared by many tables, so it identifies none of them — this
    // is exactly what stops the grader firing on a spec's own report objects.
    expect(distinctive.has("status")).toBe(false);
    expect(distinctive.has("type")).toBe(false);
    // Nor do the constrained columns themselves identify a table: the generated
    // types include VIEWS, and `open_jobs_browse` / `jobs_helper_safe` project
    // `pricing_mode`, `payment_status`, `urgent_fee` and `credential_tier`
    // alongside `jobs`. Attribution therefore rides on columns only one relation
    // has — which is why a job literal is recognised by `boost_auto_extended`,
    // not by the column that is actually being graded.
    expect(distinctive.has("pricing_mode")).toBe(false);
    expect(distinctive.has("payment_status")).toBe(false);
    expect(distinctive.get("boost_auto_extended")).toBe("jobs");
    expect(distinctive.get("idv_status")).toBe("profiles");
    expect(distinctive.get("stake_status")).toBe("applications");
    expect(distinctive.has("state")).toBe(false);
    expect(distinctive.get("capturing_from")).toBe("job_card_holds");
  });

  it("actually rejects a row the database would reject", () => {
    const jobs = constraints.get("jobs")!;
    const bad = checkRow("jobs", literalReader(`{ pricing_mode: "fixed", budget: 4 }`), jobs, "probe");
    expect(bad.map((v) => v.message).join(" | ")).toMatch(/pricing_mode/);
    expect(bad.map((v) => v.message).join(" | ")).toMatch(/budget/);
    // …and accepts one it would accept, so the grader is not simply always red.
    const good = checkRow("jobs", literalReader(`{ pricing_mode: "set_price", budget: 180 }`), jobs, "probe");
    expect(good).toEqual([]);
    expect(checkRow("jobs", literalReader(`{ credential_tier: 0 }`), jobs, "probe")).toEqual([]);
    expect(checkRow("jobs", literalReader(`{ credential_tier: 1 }`), jobs, "probe")).toMatchObject([
      { message: expect.stringContaining("jobs_credential_tier_check") },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Pass A — the seed tables, graded as real objects.
// ---------------------------------------------------------------------------
describe("every seeded row could be inserted", () => {
  // seedData.ts states the mapping itself: `SEED_TABLES = { jobs: SEED_JOBS, … }`.
  // That is the strongest attribution in the repo — the file says which table
  // each row set is for — and it reaches rows pass B cannot, because a
  // notification row is `{ id, user_id, type, title, body, read }` and carries
  // no column that only `notifications` has.
  const SEED_FILE = "e2e/happy-path/seedData.ts";
  const src = readFileSync(join(REPO, SEED_FILE), "utf8");
  const mapText = constValue(src, "SEED_TABLES") ?? "";
  const base = constValue(src, "JOB_BASE") ?? "";
  const mapping = [...mapText.matchAll(/([a-z0-9_]+):\s*([A-Z][A-Z0-9_]+)/g)];

  const violations: Violation[] = [];
  let rowsGraded = 0;
  for (const [, table, constName] of mapping) {
    const forTable = constraints.get(table);
    const arrayText = constValue(src, constName);
    if (!forTable || arrayText === null) continue;
    rowsOf(arrayText).forEach((row, i) => {
      rowsGraded++;
      // JOB_BASE is spread into every job seed, so its values are part of
      // every row — and `pricing_mode: "fixed"` lived there, in exactly one
      // place, invisible to a per-row read.
      const text = table === "jobs" ? `${row}\n${base}` : row;
      violations.push(...checkRow(table, literalReader(text), forTable, `${SEED_FILE} ${constName}[${i}]`));
    });
  }

  it("resolved the table→rows mapping and graded real rows", () => {
    expect(mapping.map((m) => m[1])).toContain("jobs");
    expect(mapping.map((m) => m[1])).toContain("notifications");
    expect(base, "JOB_BASE must resolve — pricing_mode lives only there").toContain("pricing_mode");
    expect(rowsGraded).toBeGreaterThan(10);
  });

  // Column existence and NOT NULL, from the generated Insert types. CHECK
  // constraints only grade a value that is present — a misspelled column is
  // absent from every constraint and passes by omission.
  const columns = schemaTables();
  const required = schemaRequired();
  const shapeViolations: string[] = [];
  for (const [, table, constName] of mapping) {
    const cols = columns.get(table);
    const arrayText = constValue(src, constName);
    if (!cols || arrayText === null) continue;
    rowsOf(arrayText).forEach((row, i) => {
      const text = table === "jobs" ? `${row}\n${base}` : row;
      const clean = text.replace(/^\s*\/\/[^\n]*$/gm, "");
      const keys = new Set([...clean.matchAll(/(?:^\s*|[{,]\s*)([a-z0-9_]+):/gm)].map((k) => k[1]));
      for (const k of keys) {
        if (!cols.has(k)) shapeViolations.push(`${SEED_FILE} ${constName}[${i}]: ${table}.${k} is not a column`);
      }
      // `...JOB_BASE` and other spreads hide keys from a textual read; only
      // grade required-column presence when the row is fully literal.
      if (!/\.\.\./.test(text)) {
        for (const r of required.get(table) ?? []) {
          if (!keys.has(r)) shapeViolations.push(`${SEED_FILE} ${constName}[${i}]: ${table}.${r} is NOT NULL with no default and is missing`);
        }
      }
    });
  }

  it("uses only real columns and supplies every NOT NULL column", () => {
    expect(shapeViolations, "seeded rows the database would reject on shape").toEqual([]);
  });

  it("finds no seeded row a CHECK constraint would refuse", () => {
    expect(
      violations.map((v) => `${v.where}: ${v.message}`),
      "seeded rows the database would reject",
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Pass B — every object literal in the test tree, attributed by a column name
// that only one table has.
// ---------------------------------------------------------------------------
describe("every fixture literal could be inserted", () => {
  // This guard's own files carry deliberate counter-examples (the mutation
  // probe above is literally an impossible jobs row). Grading them would mean
  // the test fails on the string that proves it works.
  const SELF = ["src/test/fixtureSchemaContract.test.ts", "src/test/helpers/schemaConstraints.ts"];
  const files = walkSource([join(REPO, "e2e"), join(REPO, "src/test")]).filter(
    (f) => !SELF.some((s) => f.endsWith(s)),
  );

  // Object literals that look like a table row but are not one. Each entry names
  // the file and the keys that identify the non-row shape.
  const NOT_ROWS = [
    // Q1920 (11-02): the scanner blanks comments and skips block bodies, so the 16 entries written for whole test
    // bodies read as one literal, or for @mutate text, matched nothing and were removed (each counted 0 matches),
    // as was a repeated stripe_mode entry.
    // Declutter slices 3-4 (2026-10-15) made `expires_at` and `series`-adjacent columns shared or new, so two
    // non-row shapes became attributable to one table: a Certificial webhook payload (not a helper_credentials
    // row) and the charge-recurring-visits mock reads `{ rows, count }` (not an ops_alert_ledger row).
    { file: "src/test/edge/verification-webhook.test.ts", keys: ["certificate_id", "expiration_date"] },
    { file: "src/test/edge/charge-recurring-visits.test.ts", keys: ["rows", "count"] },
    // 20261025161801 put gift_cards_payment_status_check in the migrations, so the gift-ledger cases' gift rows with a
    // job beside them (`{ ...job, payment_status: "unpaid" }`) became gradable as gift rows; that is not one row.
    { file: "src/test/giftCardJourneyLedger.test.ts", keys: ["id", "recipient_id", "redeemed_at", "job_id"] },
    // Shops M1 (20261018164442) gave shop_orders a decline_reason, so an applications mock read `{ rows: [{
    // status, decline_reason }], count }` lost its applications marker and `count` pointed at ops_alert_ledger.
    { file: "src/test/edge/create-notification.test.ts", keys: ["rows", "status", "decline_reason", "count"] },
    // Shipping S3 (B111, 2026-11-01): an EasyPost Rate object (`{ id, carrier, service, rate, currency }`, EasyPost's own
    // service names) is not a shipments row, but its `service` key reads as shipments.service.
    { file: "src/test/easypostLabels.test.ts", keys: ["carrier", "service", "rate", "currency"] },
    // Return labels (B69, 20261103212046): the worker's return row as shipReturnLabel.ts reads it (`{ ..., outbound_shipment_id,
    // cap_cents }`), not a shop_cottage_settings row, though `cap_cents` reads as that table's column.
    { file: "src/test/shipReturnLabel.test.ts", keys: ["outbound_shipment_id", "cap_cents"] },
    // Slice 5 (20261017055505) gave declutter_problems a named decision CHECK, so the admin audit-log `details`
    // object of a dispute split (`{ decision: "split", helper_cents, refund_cents }`) became attributable to it.
    { file: "e2e/happy-path/seedData.ts", keys: ["decision", "helper_cents", "refund_cents"] },
    // A health-check response mock (`{ checks: { stripe_mode: "missing" } }`), not a job_card_holds row: the card hold
    // (Q2399, 20261026001019) made `stripe_mode` a column only job_card_holds has.
    { file: "src/test/pressNeverWritesToLiveStripe.test.ts", keys: ["stripe_mode"] },
    // storage.objects rows (`{ bucket_id, name, size }`), not public rows: once rental_photo_purge_queue (20261019071203)
    // took bucket_id as the only public table with it, these were graded against its bucket CHECK.
    { file: "src/test/storageBackup.test.ts", keys: ["bucket_id", "name", "size"] },
    // The data-export inventory's `{ section, by }` entries, not saved_searches rows (Q2275 gave saved_searches a section CHECK).
    { file: "src/test/helpers/dataExportInventory.ts", keys: ["section", "by"] },
    // A Stripe PaymentIntent mock (`{ id, status: "succeeded", amount_received, metadata: { tax_calculation_id, ... },
    // latest_charge }`), not a recurring_visit_payments row: Q2717 (B94) put job-site tax metadata on the crew PI, and
    // `tax_calculation_id` is a column only recurring_visit_payments has.
    { file: "src/test/edge/void-cancelled-payments-crew-deleted-member.test.ts", keys: ["amount_received", "tax_calculation_id", "latest_charge"] },
    // The AI item helper's raw answer (`{ title, kind, subtype, possibly_banned }`, declutter-ai-draft's shop JSON) as
    // sanitizeShopItemDraft reads it, not a shop_items row: the sanitizer exists to turn an off-list kind into an allowed one.
    { file: "src/test/shopsItems.test.ts", keys: ["title", "kind", "subtype", "possibly_banned"] },
    // 25 Days sponsor page (20261109162829, 2026-11-09): sponsor_visits.device made `device` a column only that table has,
    // so the journeys' browser rotation objects (`{ ...rotation, device: "phone-375" }`) read as visit rows; they are not.
    { file: "e2e/journeys/02-marketplace.spec.ts", keys: ["device"] },
    { file: "e2e/journeys/post-job-day-tap.spec.ts", keys: ["device", "network"] },
    // The same migration's sponsor_days.day made `day` shared, so Stripe Identity's date of birth (`dob: { year, month,
    // day }`) is left with `year` alone and read as a facilitator_threshold_alerts row; it is not.
    { file: "src/test/edge/stripe-idv-webhook.test.ts", keys: ["year", "month", "day"] },
  ];
  type Graded = { file: string; table: string; violations: Violation[] };
  const graded: Graded[] = [];
  let valuesGraded = 0;

  for (const file of files) {
    const src = readSource(file);
    if (src === null) continue;
    const rel = file.replace(`${REPO}/`, "");
    for (const raw of objectLiterals(src)) {
      // Same reason as literalReader: a key whose preceding line is a comment
      // is invisible to a `[{,]\s*` anchor, and most keys here are annotated.
      const lit = raw.replace(/^\s*\/\/[^\n]*$/gm, "");
      const keys = [...lit.matchAll(/(?:^\s*|[{,]\s*)([a-z0-9_]+):/gm)].map((k) => k[1]);
      const tables = new Set(keys.map((k) => distinctive.get(k)).filter(Boolean) as string[]);
      // Two markers from different tables means the literal is a join row or a
      // spec's own composite; attributing it either way would be a guess.
      if (tables.size !== 1) continue;
      const table = [...tables][0];
      // Named, not general: the visual spec's `{ screen, url, width, status,
      // notes }` result object shares only `notes` with verification_exceptions.
      // A blanket "mostly foreign keys → skip" rule let badly wrong fixtures
      // through (2026-09-13), so only listed non-row shapes are skipped.
      if (NOT_ROWS.some((n) => rel === n.file && n.keys.every((k) => keys.includes(k)))) continue;
      const forTable = constraints.get(table);
      if (!forTable) continue;
      const read = literalReader(lit);
      for (const [, c] of forTable) if (read(c.column).present) valuesGraded++;
      const violations = checkRow(table, read, forTable, rel);
      if (violations.length) graded.push({ file: rel, table, violations });
    }
  }

  it("attributed and graded a non-trivial number of literals", () => {
    // A discovery pass that finds nothing passes for exactly the reason it
    // exists to prevent. Measured 2026-09-06: 482 literals attributed, 216
    // constrained values graded.
    expect(files.length).toBeGreaterThan(50);
    expect(valuesGraded).toBeGreaterThan(100);
  });

  it("finds no literal a CHECK constraint would refuse", () => {
    const offenders = [
      ...new Set(
        graded.flatMap(({ file, violations }) =>
          violations
            .filter((v) => !ACKNOWLEDGED[`${file}: ${v.message.split(" ")[0]}`])
            .map((v) => `${file}: ${v.message}`),
        ),
      ),
    ];
    expect(offenders, "fixture literals the database would reject").toEqual([]);
  });

  it("every acknowledged impossibility still exists and still fires", () => {
    // An exemption that no longer names a real offender is worse than none:
    // it reads as a known gap while quietly covering nothing.
    const stillFiring = new Set(
      graded.flatMap(({ file, violations }) => violations.map((v) => `${file}: ${v.message.split(" ")[0]}`)),
    );
    for (const key of Object.keys(ACKNOWLEDGED)) {
      const [file] = key.split(": ");
      expect(existsSync(join(REPO, file)), `ACKNOWLEDGED names a missing file: ${file}`).toBe(true);
      expect(stillFiring.has(key), `stale ACKNOWLEDGED entry — nothing violates ${key}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Pass C — `mockTable("<table>", …)`, where the spec names the table itself.
// Catches rows with no column unique to their table (a tips row is just
// `{ amount, source }`), which pass B cannot attribute.
// ---------------------------------------------------------------------------
describe("every mocked table's rows could be inserted", () => {
  const files = walkSource([join(REPO, "e2e")]);
  const offenders: string[] = [];
  let calls = 0;

  for (const file of files) {
    const src = readSource(file);
    if (src === null) continue;
    const rel = file.replace(`${REPO}/`, "");
    for (const m of src.matchAll(/mockTable\(\s*"([a-z0-9_]+)"\s*,/g)) {
      calls++;
      const table = m[1];
      const forTable = constraints.get(table);
      if (!forTable) continue;
      const args = balanced(src, src.indexOf("(", m.index!));
      if (args === null) continue;
      let text = args.slice(args.indexOf(",") + 1);
      // One level of `const NAME = { … }` resolution — this suite hoists rows
      // to a named const far more often than it inlines them. Anything less
      // direct is simply not graded; under-coverage is honest, a wrong
      // attribution is not.
      for (const id of text.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)) {
        const decl = new RegExp(`\\bconst\\s+${id[1]}\\b[^=\\n]*=\\s*`).exec(src);
        if (!decl) continue;
        const start = decl.index + decl[0].length;
        const value =
          src[start] === "{"
            ? balanced(src, start, "{", "}")
            : src[start] === "["
              ? balanced(src, start, "[", "]")
              : null;
        if (value !== null) text += `\n${value}`;
      }
      offenders.push(
        ...checkRow(table, literalReader(text), forTable, rel).map((v) => `${rel}: ${v.message}`),
      );
    }
  }

  it("found the mockTable call sites", () => {
    // Measured 2026-09-06: 66 calls across the happy-path suite.
    expect(calls).toBeGreaterThan(20);
  });

  it("finds no mocked row a CHECK constraint would refuse", () => {
    expect([...new Set(offenders)], "mocked rows the database would reject").toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Scope, stated rather than implied.
// ---------------------------------------------------------------------------
describe("what this guard does NOT cover", () => {
  it("reports its own blind spots so they are chosen, not assumed", () => {
    const notCovered = [
      "NOT NULL and required-column coverage — `satisfies JobsInsert[]` in seedData.ts already makes those a compile error; this guard adds nothing there.",
      "Postgres ENUM-typed columns (jobs.category, jobs.status, auto_tip_mode) — the generated Insert types already constrain them, and `jobs.status` carries no CHECK at all in prod.",
      "Conditional and multi-column CHECKs (marketing_content_*, profiles_auto_tip_valid, jobs_urgent_fee_required, jobs_series_is_not_group) — deliberately skipped; see schemaConstraints.ts.",
      "Four live constraints that exist in no migration (profiles_id_verification_status_check, profiles_insurance_status_check, profiles_license_status_check, applications_ck_applications_stake_amount_nonneg) — added outside the ledger and unrecoverable from files.",
      "Rows built by a function call or a spread of a computed value — only object literals and one level of const resolution are read.",
      "Foreign keys, uniqueness, and RLS — a fixture can still describe a row that no policy would let its author write.",
    ];
    // Kept as an assertion rather than a comment so it is reviewed with the
    // code and cannot silently rot into a stale docstring.
    expect(notCovered.length).toBe(6);
    expect(readFileSync(join(REPO, "src/test/helpers/schemaConstraints.ts"), "utf8")).toContain(
      "DELIBERATELY DOES NOT",
    );
  });
});
