/**
 * Landlord ID: free, admin-reviewed, private (owner 2026-10-19 pop-up:
 * "REPLACE the paid Stripe check"; landlords upload a photo of their ID with
 * their ownership proof, an admin approves or rejects it, no charge anywhere).
 *
 * THE OLD BEHAVIOUR this fails on (ready/landlord-idv-1019, dropped from its
 * landing train 2026-10-19 and never on main): a $1.85 Stripe
 * Checkout ("Verify your ID ($1.85)") through stripe-idv-start action
 * "checkout", the idvFee config, settleIdvFee in stripe-webhook, the
 * idv_fee_payments ledger and its two fee refunds.
 *
 * INVENTORY: every non-test .ts/.tsx under src/ and supabase/functions/,
 * comments blanked with the shared helper. Then:
 *   1. no token of the paid path survives (EXACT: zero hits);
 *   2. stripe-idv-start creates no Checkout and no refund (it is main's
 *      Stripe Identity starter again, plus the one-rule "already verified");
 *   3. no migration creates the ledger (landlord-idv-1019 never landed);
 *   4. the ID photo goes to the private user-documents bucket, in the caller's
 *      own folder, and no migration ever makes that bucket public;
 *   5. the retention constant is the owner's 30 days.
 * Behaviour (owner + admin read only, approve / reject, retention SQL):
 * src/test/pglite/landlordIdReview.pglite.mjs.
 *
 * @mutate src/lib/rentals/api.ts | const RENTALS_BUCKET = "user-documents"; | const RENTALS_BUCKET = "job-photos";
 * @mutate src/lib/rentals/api.ts |   const frontPath = await uploadOwn(`${uid}/landlord-id/ |   const frontPath = await uploadOwn(`landlord-id/${uid}/
 * @mutate supabase/functions/stripe-idv-start/index.ts |     const session = await stripe.identity.verificationSessions.create({ |     await stripe.checkout.sessions.create({ mode: "payment" });\n    const session = await stripe.identity.verificationSessions.create({
 */
import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";
import { migrationFiles } from "./helpers/effectiveFunctionDefs";
import { LANDLORD_ID_RETENTION_DAYS, LANDLORD_ID_BUCKET } from "../../supabase/functions/_shared/landlordIdRetention";

const REPO = resolve(__dirname, "..", "..");
const MIGRATIONS = join(REPO, "supabase", "migrations");
const PAID_TOKENS: RegExp[] = [
  /\bidvFee\b/, /\bIDV_FEE_\w+/, /\bsettleIdvFee\b/, /\bidv_fee_payments\b/, /\bpayForIdCheck\b/, /\bstartIdCheck\b/,
  /\bneedsIdvFee\b/, /["']\.\.?\/.*idCheck["']/, /\$1\.85/,
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === "node_modules" || entry === "test" || entry === "__tests__") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.(ts|tsx)$/.test(entry)) out.push(p);
  }
  return out;
}
const code = (rel: string) => blankComments(readFileSync(join(REPO, rel), "utf8"));

describe("landlord ID: free, admin-reviewed, private (owner 2026-10-19)", () => {
  const files = ["src", "supabase/functions"].flatMap((r) => walk(join(REPO, r))).map((f) => ({
    file: relative(REPO, f),
    text: blankComments(readFileSync(f, "utf8")),
  }));

  it("walks the real tree (not vacuous)", () => {
    expect(files.length).toBeGreaterThan(800);
    expect(files.some((f) => f.file === "supabase/functions/stripe-idv-start/index.ts")).toBe(true);
  });

  it("no part of the paid ID check survives in code", () => {
    const hits = files
      .filter((f) => f.file !== "src/integrations/supabase/types.ts")
      .flatMap((f) => PAID_TOKENS.filter((re) => re.test(f.text)).map((re) => `${f.file} :: ${re.source}`));
    expect(hits).toEqual([]);
  });

  it("stripe-idv-start sells nothing and refunds nothing", () => {
    const start = code("supabase/functions/stripe-idv-start/index.ts");
    expect(start).not.toMatch(/checkout\.sessions\.create/);
    expect(start).not.toMatch(/refunds\.create/);
    expect(start).not.toMatch(/body\??\.action|action\s*===\s*["']checkout["']/);
    const webhook = code("supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts");
    expect(webhook).not.toMatch(/idv/i);
  });

  it("no migration creates the paid-check ledger (idv_fee_payments) or a fee for the ID check", () => {
    const hits = migrationFiles(MIGRATIONS).filter((f) =>
      /\bidv_fee_payments\b|\bidv_fee\w*/i.test(blankSqlComments(readFileSync(join(MIGRATIONS, f), "utf8"))));
    expect(hits).toEqual([]);
  });

  it("the ID photo goes to the PRIVATE user-documents bucket, in the caller's own landlord-id/ folder", () => {
    const api = code("src/lib/rentals/api.ts");
    expect(api).toContain('const RENTALS_BUCKET = "user-documents";');
    expect(LANDLORD_ID_BUCKET).toBe("user-documents");
    expect(api).toMatch(/const frontPath = await uploadOwn\(`\$\{uid\}\/landlord-id\//);
    expect(api).toMatch(/\? await uploadOwn\(`\$\{uid\}\/landlord-id\//);
    // The RPC re-checks the folder against auth.uid() (bad_id_path), so a client cannot point at another's file.
    const mig = blankSqlComments(readFileSync(join(MIGRATIONS, "20261019051407_rentals_landlord_id_review.sql"), "utf8"));
    expect(mig).toContain("v_pattern := format('^%s/landlord-id/[A-Za-z0-9._-]{1,100}$', v_uid);");
    // Its FINAL declared state is private: replay every bucket INSERT / UPDATE in order (it was public
    // once, 20260427011417, and made private by 20260505220000; a later flip back fails here).
    let isPublic: boolean | null = null;
    for (const f of migrationFiles(MIGRATIONS)) {
      const sql = blankSqlComments(readFileSync(join(MIGRATIONS, f), "utf8"));
      for (const m of sql.matchAll(/insert\s+into\s+storage\.buckets[\s\S]*?;|update\s+storage\.buckets\s+set\s+([\s\S]*?)\s+where\s+([\s\S]*?);/gi)) {
        if (/^insert/i.test(m[0])) {
          const t = m[0].match(/\(\s*'user-documents'\s*,\s*'user-documents'\s*,\s*(true|false)\b/i);
          if (t) isPublic = t[1].toLowerCase() === "true";
        } else if (/'user-documents'/.test(m[2] ?? "")) {
          const t = (m[1] ?? "").match(/public\s*=\s*(true|false)/i);
          if (t) isPublic = t[1].toLowerCase() === "true";
        }
      }
    }
    expect(isPublic, "user-documents must end up PRIVATE (it holds landlord ID photos)").toBe(false);
  });

  it("the ID photos are kept 30 days after the decision (owner 2026-10-19), one constant", () => {
    expect(LANDLORD_ID_RETENTION_DAYS).toBe(30);
    const home = code("src/components/rentals/LandlordIdReview.tsx");
    expect(home).toContain("We delete the photo {LANDLORD_ID_RETENTION_DAYS} days after it's checked.");
  });
});
