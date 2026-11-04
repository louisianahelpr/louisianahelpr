// Q2083 (b), quote-request bookings (20261103205121_quote_request_zip_tax_kind.sql): a job booked from quotes
// carries the job ZIP and the poster's taxed-kind answer, as a posted job does, because create-payment prices
// a taxable job's sales tax at jobs.zip_code and refuses a taxable job with no Louisiana ZIP.
//
// Reads the NEWEST definitions (effectiveDefs: any dollar tag, later restatements win) and the client source
// with comments blanked. Behaviour proof: src/test/pglite/quoteRequestZipTaxKind.pglite.mjs (16/16 after,
// applied 3x; 13 of 16 fail with this migration left out).
//
// @mutate supabase/migrations/20261103205121_quote_request_zip_tax_kind.sql |           p_req.zip_code, p_req.tax_kind) |           NULL, p_req.tax_kind)
// @mutate supabase/migrations/20261103205121_quote_request_zip_tax_kind.sql |     RAISE EXCEPTION 'invalid_zip' USING ERRCODE = '22023', DETAIL | RAISE NOTICE 'invalid_zip' USING DETAIL
// @mutate supabase/migrations/20261103205121_quote_request_zip_tax_kind.sql | DROP FUNCTION IF EXISTS public.create_quote_request(text, text, text, date, time, numeric, text, numeric, numeric, text, integer); | SELECT 1;
// @mutate supabase/migrations/20261103205121_quote_request_zip_tax_kind.sql |   IF public.is_job_labor_taxable(v_category, NULL) THEN |   IF false THEN
// @mutate supabase/migrations/20261103205121_quote_request_zip_tax_kind.sql |     RAISE EXCEPTION 'too_many_open_requests' USING ERRCODE = 'P0001', |     RAISE EXCEPTION 'too_many_open_requests' USING ERRCODE = '54000',
// @mutate supabase/migrations/20261103205121_quote_request_zip_tax_kind.sql |     NEW.zip_code := NULL; |
// @mutate src/lib/quotes/api.ts |       p_zip_code: r.zipCode, |
// @mutate src/pages/post-job/CheckoutStepView.tsx |     parish: form.parish, taxKind: form.taxKind, |     parish: form.parish, taxKind: null,
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const root = resolve(__dirname, "../..");
const DIR = resolve(root, "supabase/migrations");
const defs = effectiveDefs(DIR);
const body = (fn: string) => blankSqlComments(defs.get(fn)?.stmt ?? "");
const src = (p: string) => blankComments(readFileSync(resolve(root, p), "utf8"));
const allSql = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => blankSqlComments(readFileSync(resolve(DIR, f), "utf8")))
  .join("\n");

describe("a quote-booked job carries the job ZIP and tax_kind (Q2083 b)", () => {
  it("quote_insert_job copies zip_code and tax_kind from the request onto the job", () => {
    const b = body("quote_insert_job");
    const cols = (b.match(/insert\s+into\s+public\.jobs\s*\(([^)]*)\)/i)?.[1] ?? "").split(",").map((c) => c.trim());
    expect(cols.length).toBeGreaterThan(10);
    const vals = (b.match(/VALUES\s*\(([\s\S]*?)\)\s*RETURNING/i)?.[1] ?? "");
    // The values line up with the columns: the last two are the request's zip_code and tax_kind.
    expect(cols.slice(-2)).toEqual(["zip_code", "tax_kind"]);
    expect(vals).toMatch(/p_req\.zip_code\s*,\s*p_req\.tax_kind\s*$/);
  });

  it("job_quote_requests has both columns, tax_kind with the jobs CHECK", () => {
    expect(allSql).toMatch(/ALTER TABLE public\.job_quote_requests ADD COLUMN IF NOT EXISTS zip_code text;/);
    expect(allSql).toMatch(/ALTER TABLE public\.job_quote_requests ADD COLUMN IF NOT EXISTS tax_kind text;/);
    expect(allSql).toMatch(/job_quote_requests_tax_kind_valid CHECK \(tax_kind IS NULL OR tax_kind IN \('item_repair', 'fabric_cleaning', 'clothes_cleaning', 'clothing_alterations'\)\)/);
  });

  it("create_quote_request requires a Louisiana ZIP (400, not 500) and stores both", () => {
    const b = body("create_quote_request");
    expect(b).toMatch(/p_zip_code text DEFAULT NULL,\s*p_tax_kind text DEFAULT NULL\s*\)/);
    expect(b).toMatch(/IF v_zip !~ '\^\(70\[0-9\]\|71\[0-4\]\)\[0-9\]\{2\}\$' THEN\s+RAISE EXCEPTION 'invalid_zip' USING ERRCODE = '22023'/);
    expect(b).toMatch(/RAISE EXCEPTION 'invalid_tax_kind' USING ERRCODE = '22023'/);
    // PostgREST maps 54* (the old code) to 500; P0001 is 400.
    expect(b).toMatch(/RAISE EXCEPTION 'too_many_open_requests' USING ERRCODE = 'P0001'/);
    expect(b).toMatch(/IF public\.is_job_labor_taxable\(v_category, NULL\) THEN\s+v_tax_kind := NULL;/);
    expect(b).toMatch(/is_seed,\s+zip_code, tax_kind\)/);
    expect(b).toMatch(/v_zip, v_tax_kind\)\s+RETURNING id INTO v_id;/);
  });

  it("the 11-argument overload is dropped, so exactly one create_quote_request exists; grants restated", () => {
    const drop = allSql.lastIndexOf("DROP FUNCTION IF EXISTS public.create_quote_request(text, text, text, date, time, numeric, text, numeric, numeric, text, integer);");
    const create = allSql.lastIndexOf("CREATE OR REPLACE FUNCTION public.create_quote_request(");
    expect(drop).toBeGreaterThan(0);
    expect(create).toBeGreaterThan(drop);
    const sig = "public.create_quote_request(text, text, text, date, time, numeric, text, numeric, numeric, text, integer, text, text)";
    expect(allSql).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC, anon;`);
    expect(allSql).toContain(`GRANT EXECUTE ON FUNCTION ${sig} TO authenticated, service_role;`);
  });

  it("account deletion clears the request's ZIP with its address, as for jobs.zip_code", () => {
    expect(body("quote_request_follows_poster_deletion")).toMatch(/NEW\.longitude := NULL;\s+NEW\.zip_code := NULL;/);
  });

  it("the client sends the ZIP and the Details answer from the quote ask", () => {
    const api = src("src/lib/quotes/api.ts");
    expect(api).toMatch(/p_zip_code: r\.zipCode,/);
    expect(api).toMatch(/p_tax_kind: r\.taxKind \?\? undefined,/);
    const ask = src("src/components/quotes/PostJobQuoteChoice.tsx");
    expect(ask).toMatch(/zipCode: f\.zipCode\.replace\(\/\\D\/g, ""\)\.slice\(0, 5\),/);
    expect(ask).toMatch(/taxKind: f\.taxKind,/);
    expect(src("src/pages/post-job/CheckoutStepView.tsx")).toMatch(/taxKind: form\.taxKind,\s*\}\);/);
  });
});
