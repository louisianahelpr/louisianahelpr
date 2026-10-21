#!/usr/bin/env node
/**
 * PGlite proof for 20261021112534_block_closes_agreed_unbooked_quote.sql (Q2122).
 *
 *   node src/test/pglite/blockClosesAgreedUnbookedQuote.pglite.mjs                    # AFTER: prior body, then the fix 3x
 *   NEW_MIGRATION=skip node src/test/pglite/blockClosesAgreedUnbookedQuote.pglite.mjs # RED: the prior body (20261018155222)
 *
 * A block closes the pair's pending quotes (unchanged) AND an accepted quote whose request is agreed but never
 * booked (job_id NULL), cancelling that request; a booked request and other pairs are untouched.
 */
import { PGlite, newestFunctionSql, readMigration } from "./seriesWorld.mjs";

const FIX = readMigration("20261021112534_block_closes_agreed_unbooked_quote.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: the prior body (expect FAILs)`);
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P = U(1), Q = U(2), OTHER = U(3), JOB = U(90);

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.error_logs (id serial PRIMARY KEY, severity text, message text, tags jsonb, context jsonb);
  CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
  CREATE TABLE public.job_quote_requests (id serial PRIMARY KEY, poster_id uuid, status text, job_id uuid, updated_at timestamptz);
  CREATE TABLE public.job_quotes (id serial PRIMARY KEY, request_id int, quoter_id uuid, status text, updated_at timestamptz);
  ${newestFunctionSql("quote_close_pending_across_block", "20261021112534").sql}
  CREATE TRIGGER trg_quote_close_pending_across_block AFTER INSERT ON public.user_blocks
    FOR EACH ROW EXECUTE FUNCTION public.quote_close_pending_across_block();
  -- r1: agreed, unbooked, Q's quote accepted (the Q2122 case). r2: open, Q pending + OTHER pending.
  -- r3: agreed and BOOKED (job_id set). r4: agreed unbooked but with OTHER (not blocked).
  INSERT INTO public.job_quote_requests (poster_id, status, job_id) VALUES
    ('${P}', 'agreed', NULL), ('${P}', 'open', NULL), ('${P}', 'agreed', '${JOB}'), ('${P}', 'agreed', NULL);
  INSERT INTO public.job_quotes (request_id, quoter_id, status) VALUES
    (1, '${Q}', 'accepted'), (1, '${OTHER}', 'closed'),
    (2, '${Q}', 'pending'), (2, '${OTHER}', 'pending'),
    (3, '${Q}', 'accepted'),
    (4, '${OTHER}', 'accepted');
`);
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(FIX);
await db.exec(`INSERT INTO public.user_blocks VALUES ('${Q}', '${P}')`);

let fails = 0, n = 0;
const check = (name, ok, got) => { n++; if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  got ${JSON.stringify(got)}`}`); };
const req = async (id) => (await db.query(`SELECT status FROM public.job_quote_requests WHERE id = ${id}`)).rows[0].status;
const quote = async (id) => (await db.query(`SELECT status FROM public.job_quotes WHERE id = ${id}`)).rows[0].status;
check("Q2122: the accepted, unbooked quote closes", (await quote(1)) === "closed", await quote(1));
check("Q2122: and its request is cancelled", (await req(1)) === "cancelled", await req(1));
check("a pending quote across the block closes (unchanged)", (await quote(3)) === "closed", await quote(3));
check("another quoter's pending quote stays", (await quote(4)) === "pending", await quote(4));
check("a BOOKED request keeps its accepted quote (the job's own flow handles it)", (await quote(5)) === "accepted" && (await req(3)) === "agreed");
check("another pair's agreed request is untouched", (await quote(6)) === "accepted" && (await req(4)) === "agreed");
check("no error was logged", (await db.query(`SELECT count(*)::int AS n FROM public.error_logs`)).rows[0].n === 0);
// The other direction: the POSTER blocks the quoter (review nit 1, both halves of the OR).
await db.exec(`DELETE FROM public.user_blocks; UPDATE public.job_quote_requests SET status = 'agreed' WHERE id = 1;
  UPDATE public.job_quotes SET status = 'accepted' WHERE id = 1`);
await db.exec(`INSERT INTO public.user_blocks VALUES ('${P}', '${Q}')`);
check("the poster blocking the quoter also closes the accepted, unbooked quote", (await quote(1)) === "closed", await quote(1));
check("and cancels its request", (await req(1)) === "cancelled", await req(1));
console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
