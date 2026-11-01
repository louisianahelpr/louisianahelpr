#!/usr/bin/env node
/**
 * PGlite proof for 20261101065105_instant_book_booking.sql (CMP-4 slices 2 and
 * 3, lead 2026-11-01 design A: the card stays HELD through the 2-hour window).
 *
 *   node src/test/pglite/instantBookBooking.pglite.mjs                     # GREEN, both migrations applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/instantBookBooking.pglite.mjs  # RED: slice 1 only
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/instantBookBooking.pglite.mjs
 *
 * The world is instantBookFloors.pglite.mjs's SCHEMA (read from that file:
 * real jobs columns from cardHoldAtPost.pglite.mjs, real helper_availability,
 * reviews, profiles), plus notifications and job_accept_pending with their
 * real columns (types.ts; 20261003193541). complete_direct_offer_accept is a
 * stub with the one rule this proof leans on (Q2399: a held card never
 * completes a hire); the capture itself is TypeScript and is proven in
 * src/test/instantBookSweep.test.ts.
 *
 *   B1  Book now: only the poster, only a qualifying Helpr; one code for every refusal (never which check)
 *   B2  Book now moves NO money: payment_status stays 'held'; the window is 2 h; both sides told once, in instant words
 *   B3  the generic direct-offer notice does not fire for a booking (no "You got a direct job offer!")
 *   B4  a member's own UPDATE can't set, clear or re-point a booking (instant_book_server_only); INSERT can't forge one
 *   B5  decline: only the booked Helpr; no money moves; the job is open again with no offer; the poster hears "can't make it ... not charged"
 *   B6  a declined Helpr is never offered that job again; a second decline is refused
 *   B7  early confirm on a held card does not hire (the capture must come first); once captured it hires and the window closes itself
 *   B8  capture failure: instant_book_payment_failed ends the booking, tells both once; a second run is a no-op (false)
 *   B10 a generic decline of a booking (respond_to_direct_offer's 'declined') also keeps that Helpr off the job
 *   B9  instant_book_payment_failed and the declines table are server-only; rpc_my_instant_bookings shows only the caller's live bookings, never a floor
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SLICE1 = "20261101063725_instant_book_floors.sql";
const THIS = "20261101065105_instant_book_booking.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";

const floorsProof = readFileSync(new URL("./instantBookFloors.pglite.mjs", import.meta.url), "utf8");
const JOB_COLUMNS = readFileSync(new URL("./cardHoldAtPost.pglite.mjs", import.meta.url), "utf8").match(/const JOB_COLUMNS = `([\s\S]*?)`;/)[1];
const SCHEMA = floorsProof.match(/const SCHEMA = `([\s\S]*?)`;/)[1].replace("${JOB_COLUMNS}", JOB_COLUMNS);
const LISTED = floorsProof.includes('priorNewest("job_payment_is_listed")')
  ? readFileSync(`${DIR}20261027185146_card_hold_at_post.sql`, "utf8").match(/CREATE OR REPLACE FUNCTION public\.job_payment_is_listed[\s\S]*?\$fn\$;/)[0]
  : "";

const EXTRA = `
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, title text NOT NULL, message text NOT NULL,
  type text NOT NULL DEFAULT 'info', read boolean NOT NULL DEFAULT false, link text, job_id uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.job_accept_pending (job_id uuid PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE, helper_id uuid NOT NULL, requested_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION public.quote_job_offered_to_quoter(j uuid, h uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
-- Stub: the Q2399 rule only (a held card never completes a hire), then the hire.
CREATE FUNCTION public.complete_direct_offer_accept(p_job_id uuid, p_helper uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF (SELECT payment_status FROM public.jobs WHERE id = p_job_id FOR UPDATE) = 'held' THEN RETURN NULL; END IF;
  UPDATE public.jobs SET status = 'accepted', helper_id = p_helper, direct_offer_status = 'accepted', direct_offer_expires_at = NULL
   WHERE id = p_job_id AND status = 'open' AND helper_id IS NULL AND offered_to_helper_id = p_helper AND direct_offer_status = 'pending';
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('action', 'accepted');
END $$;
GRANT SELECT, UPDATE, INSERT ON public.jobs TO authenticated;
CREATE TRIGGER trg_notify_helper_on_direct_offer AFTER INSERT OR UPDATE OF offered_to_helper_id, payment_status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.notify_helper_on_direct_offer();
`;
// The generic notice, as it was before this migration (the newest definition, card_hold_at_post).
const NOTIFY_BEFORE = readFileSync(`${DIR}20261027185146_card_hold_at_post.sql`, "utf8")
  .match(/CREATE OR REPLACE FUNCTION public\.notify_helper_on_direct_offer\(\)[\s\S]*?\$function\$;/)[0];

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec("SET check_function_bodies = off;");
await db.exec(LISTED);
await db.exec(NOTIFY_BEFORE);
await db.exec(EXTRA);
const s1 = readFileSync(DIR + SLICE1, "utf8");
for (let i = 0; i < 3; i++) await db.exec(s1);
if (!SKIP) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? DIR + THIS, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(sql);
}
await db.exec("SET check_function_bodies = on;");

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (ok) pass++; else fail++;
};
async function as(who, uid, sql) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid ?? ""}'; SET request.jwt.claim.role = '${who}'; SET ROLE ${who};`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e) };
  } finally {
    await db.exec(`RESET ROLE; SET request.jwt.claim.sub = ''; SET request.jwt.claim.role = '';`);
  }
}
async function owner(sql) {
  try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e) }; }
}
const err = (r) => (r && !Array.isArray(r) ? r.error : "");
const ok = (r) => Array.isArray(r);

// ─── the world: one poster, Helprs A and B qualify, LOW's floor is above the price ──
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const P = id(1), OTHER = id(2), RP = id(3), A = id(11), B = id(12), LOW = id(13);
const H = [A, B, LOW];
const J = id(101), J2 = id(102);
const ids = [P, OTHER, RP, ...H];
await db.exec(`INSERT INTO auth.users (id) SELECT unnest(ARRAY[${ids.map((u) => `'${u}'::uuid`).join(",")}]);
  INSERT INTO public.profiles (user_id, full_name) VALUES ('${P}', 'Pat Poster'), ('${OTHER}', 'Olive Other'), ('${RP}', 'Rae P'),
    ('${A}', 'Ana Able'), ('${B}', 'Ben Baker'), ('${LOW}', 'Lou Low');
  INSERT INTO public._ready SELECT unnest(ARRAY[${H.map((u) => `'${u}'::uuid`).join(",")}]);`);
const day = "current_date + 2";
await owner(`INSERT INTO public.jobs (id, customer_id, title, description, category, date_needed, budget, payment_status) VALUES
  ('${J}', '${P}', 'Mow the yard', 'd', 'yard_work', ${day}, 60, 'held'),
  ('${J2}', '${P}', 'Rake leaves', 'd', 'yard_work', ${day}, 60, 'held')`);
let n = 1000;
for (const h of H) for (let i = 0; i < 3; i++) {
  await owner(`INSERT INTO public.jobs (id, customer_id, helper_id, title, description, category, budget, status, payment_status)
    VALUES ('${id(n++)}', '${RP}', '${h}', 'old', 'd', 'yard_work', 50, 'completed', 'released')`);
  await owner(`INSERT INTO public.helper_availability (helper_id, day_of_week, is_available) VALUES ('${h}', extract(dow FROM ${day})::int, true)`);
}
for (const [h, c] of [[A, 5000], [B, 6000], [LOW, 7000]]) {
  const r = await as("authenticated", h, `SELECT public.rpc_set_instant_book_floor('yard_work', ${c})`);
  if (!ok(r)) console.log("setup floor failed", err(r));
}
const notes = async (uid, jid = J) => owner(`SELECT title, message, type FROM public.notifications WHERE user_id = '${uid}' AND job_id = '${jid}' ORDER BY created_at, title`);
const jobRow = async (jid = J) => (await owner(`SELECT status::text AS status, payment_status, helper_id, offered_to_helper_id, direct_offer_status,
  instant_booked_at, instant_decline_until, round(extract(epoch FROM instant_decline_until - instant_booked_at))::int AS window_s FROM public.jobs WHERE id = '${jid}'`))[0] ?? {};

// ─── B1 who may book whom ───────────────────────────────────────────────────
const notPoster = await as("authenticated", OTHER, `SELECT public.rpc_instant_book('${J}', '${A}')`);
const anon = await as("anon", null, `SELECT public.rpc_instant_book('${J}', '${A}')`);
const lowFloor = await as("authenticated", P, `SELECT public.rpc_instant_book('${J}', '${LOW}')`);
const stranger = await as("authenticated", P, `SELECT public.rpc_instant_book('${J}', '${OTHER}')`);
check("B1 Book now: only the poster, only a qualifying Helpr; a floor above the price and a Helpr with no floor answer the same code",
  /not_authorized/.test(err(notPoster)) && /permission denied/.test(err(anon))
    && /instant_book_unavailable/.test(err(lowFloor)) && /instant_book_unavailable/.test(err(stranger))
    && err(lowFloor) === err(stranger) && !/floor|7000|6000/.test(err(lowFloor)),
  [err(notPoster), err(anon), err(lowFloor), err(stranger)].join(" | "));

// ─── B2 / B3 the booking ────────────────────────────────────────────────────
const booked = await as("authenticated", P, `SELECT public.rpc_instant_book('${J}', '${A}') AS r`);
const row = await jobRow();
const aNotes = await notes(A);
const pNotes = await notes(P);
check("B2 Book now moves no money (still 'held'), opens a 2-hour window on a pending offer to that Helpr, and tells both once",
  ok(booked) && booked[0].r?.action === "booked" && row.payment_status === "held" && row.status === "open" && row.helper_id === null
    && row.offered_to_helper_id === A && row.direct_offer_status === "pending" && row.window_s === 7200
    && ok(aNotes) && aNotes.length === 1 && aNotes[0].title === "You're booked" && /Decline by .* nothing is charged/.test(aNotes[0].message)
    && ok(pNotes) && pNotes.length === 1 && /Your card is charged after that/.test(pNotes[0].message),
  err(booked) || JSON.stringify({ row, aNotes, pNotes }));
check("B3 the generic \"You got a direct job offer!\" notice does not fire for a booking",
  ok(aNotes) && !aNotes.some((x) => /direct job offer/.test(x.title)), JSON.stringify(aNotes));
const again = await as("authenticated", P, `SELECT public.rpc_instant_book('${J}', '${B}')`);

// ─── B4 the columns are the server's ────────────────────────────────────────
const w1 = await as("authenticated", P, `UPDATE public.jobs SET instant_decline_until = now() - interval '1 minute' WHERE id = '${J}'`);
const w2 = await as("authenticated", P, `UPDATE public.jobs SET offered_to_helper_id = '${B}' WHERE id = '${J}'`);
const w3 = await as("authenticated", P, `UPDATE public.jobs SET direct_offer_status = 'declined' WHERE id = '${J}'`);
const w4 = await as("authenticated", P, `INSERT INTO public.jobs (id, customer_id, title, description, category, budget, payment_status, instant_decline_until)
  VALUES ('${id(150)}', '${P}', 'x', 'd', 'yard_work', 60, 'unpaid', now())`);
const w5 = await as("authenticated", P, `UPDATE public.jobs SET description = 'new words' WHERE id = '${J}'`);
const after4 = await jobRow();
check("B4 a member's own write can't set, clear or re-point a booking, nor forge one on INSERT; other edits still work",
  [w1, w2, w3, w4].every((r) => /instant_book_server_only/.test(err(r))) && ok(w5) && /instant_book_unavailable/.test(err(again))
    && after4.offered_to_helper_id === A && after4.window_s === 7200,
  [err(w1), err(w2), err(w3), err(w4), err(w5), err(again)].join(" | "));

// ─── B5 / B6 decline ────────────────────────────────────────────────────────
const wrongDecline = await as("authenticated", B, `SELECT public.rpc_instant_book_decline('${J}')`);
await owner(`INSERT INTO public.job_accept_pending (job_id, helper_id) VALUES ('${J}', '${A}')`);
const dec = await as("authenticated", A, `SELECT public.rpc_instant_book_decline('${J}') AS r`);
const r5 = await jobRow();
const pAfter = await notes(P);
const pend = await owner(`SELECT count(*)::int AS n FROM public.job_accept_pending WHERE job_id = '${J}'`);
const backout = await owner(`SELECT count(*)::int AS n FROM public.notifications WHERE user_id = '${P}' AND title ILIKE '%declined%'`);
check("B5 decline: only the booked Helpr; no money moves (still 'held'); the job is open with no offer; the poster hears it once",
  /not_your_offer/.test(err(wrongDecline)) && ok(dec) && dec[0].r?.action === "declined"
    && r5.payment_status === "held" && r5.status === "open" && r5.helper_id === null && r5.offered_to_helper_id === null
    && r5.direct_offer_status === null && r5.instant_decline_until === null && ok(pend) && pend[0].n === 0
    && ok(pAfter) && pAfter.length === 2 && pAfter.some((x) => x.message === "Ana can't make it. Your card was not charged. Your job is open again for other Helprs.")
    && ok(backout) && backout[0].n === 0,
  err(wrongDecline) || err(dec) || JSON.stringify({ r5, pAfter }));
const dec2 = await as("authenticated", A, `SELECT public.rpc_instant_book_decline('${J}')`);
const reA = await as("authenticated", P, `SELECT public.rpc_instant_book('${J}', '${A}')`);
const cands = await as("authenticated", P, `SELECT helper_id FROM public.instant_book_candidates('${J}')`);
check("B6 a declined Helpr is never offered that job again (book and list); a second decline is refused",
  /not_your_offer|booking_not_pending/.test(err(dec2)) && /instant_book_unavailable/.test(err(reA))
    && ok(cands) && cands.map((c) => c.helper_id).join(",") === B,
  [err(dec2), err(reA), JSON.stringify(cands)].join(" | "));

// ─── B7 early confirm: a held card never hires; captured, it hires ──────────
const bookB = await as("authenticated", P, `SELECT public.rpc_instant_book('${J}', '${B}')`);
const heldTry = await owner(`SELECT public.complete_direct_offer_accept('${J}', '${B}') AS r`);
const stillOpen = await jobRow();
await owner(`UPDATE public.jobs SET payment_status = 'escrow' WHERE id = '${J}'`); // captureCardHold's move
const hired = await owner(`SELECT public.complete_direct_offer_accept('${J}', '${B}') AS r`);
const r7 = await jobRow();
const lateDecline = await as("authenticated", B, `SELECT public.rpc_instant_book_decline('${J}')`);
check("B7 early confirm: a held card does not hire; once captured the hire completes, the window closes itself, and a late decline is refused",
  ok(bookB) && ok(heldTry) && heldTry[0].r === null && stillOpen.status === "open" && stillOpen.instant_decline_until !== null
    && ok(hired) && hired[0].r?.action === "accepted" && r7.status === "accepted" && r7.helper_id === B && r7.instant_decline_until === null
    && /booking_not_pending/.test(err(lateDecline)),
  err(bookB) || JSON.stringify({ heldTry, stillOpen, r7 }) + " " + err(lateDecline));

// ─── B8 capture failure ─────────────────────────────────────────────────────
const bookJ2 = await as("authenticated", P, `SELECT public.rpc_instant_book('${J2}', '${A}')`);
await owner(`UPDATE public.jobs SET payment_status = 'failed' WHERE id = '${J2}'`); // the hold code: off the listing
const f1 = await as("service_role", null, `SELECT public.instant_book_payment_failed('${J2}') AS r`);
const f2 = await as("service_role", null, `SELECT public.instant_book_payment_failed('${J2}') AS r`);
const r8 = await jobRow(J2);
const a8 = await notes(A, J2);
const p8 = await notes(P, J2);
check("B8 a refused card ends the booking (no hire, no offer) and tells both once; a second run is a no-op",
  ok(bookJ2) && ok(f1) && f1[0].r === true && ok(f2) && f2[0].r === false
    && r8.status === "open" && r8.helper_id === null && r8.offered_to_helper_id === null && r8.instant_decline_until === null && r8.payment_status === "failed"
    && ok(a8) && a8.filter((x) => x.title === "Booking didn't go through").length === 1
    && ok(p8) && p8.filter((x) => x.title === "Your booking didn't go through").length === 1,
  err(bookJ2) || err(f1) || JSON.stringify({ r8, a8, p8 }));

// ─── B9 server-only pieces and the Helpr's own list ─────────────────────────
const m1 = await as("authenticated", P, `SELECT public.instant_book_payment_failed('${J2}')`);
const m2 = await as("authenticated", A, `SELECT * FROM public.instant_book_declines`);
await owner(`UPDATE public.jobs SET payment_status = 'held' WHERE id = '${J2}'`);
await owner(`DELETE FROM public.instant_book_declines WHERE job_id = '${J2}'`);
const bookAgain = await as("authenticated", P, `SELECT public.rpc_instant_book('${J2}', '${A}')`);
const mineA = await as("authenticated", A, `SELECT * FROM public.rpc_my_instant_bookings()`);
const mineB = await as("authenticated", B, `SELECT * FROM public.rpc_my_instant_bookings()`);
check("B9 payment_failed and the declines table are server-only; rpc_my_instant_bookings shows only the caller's live bookings, never a floor",
  /permission denied/.test(err(m1)) && /permission denied/.test(err(m2)) && ok(bookAgain)
    && ok(mineA) && mineA.length === 1 && mineA[0].job_id === J2 && !Object.keys(mineA[0]).some((k) => /floor/i.test(k))
    && ok(mineB) && mineB.length === 0,
  [err(m1), err(m2), err(bookAgain), JSON.stringify(mineA), JSON.stringify(mineB)].join(" | "));

// ─── B10 a generic decline (respond_to_direct_offer writes 'declined' as definer) ──
const J3 = id(103);
await owner(`INSERT INTO public.jobs (id, customer_id, title, description, category, date_needed, budget, payment_status) VALUES
  ('${J3}', '${P}', 'Trim hedges', 'd', 'yard_work', ${day}, 60, 'held')`);
const bookJ3 = await as("authenticated", P, `SELECT public.rpc_instant_book('${J3}', '${B}')`);
await owner(`UPDATE public.jobs SET direct_offer_status = 'declined' WHERE id = '${J3}'`);
const r10 = await jobRow(J3);
const reB = await as("authenticated", P, `SELECT public.rpc_instant_book('${J3}', '${B}')`);
check("B10 a generic decline closes the window and keeps that Helpr off the job",
  ok(bookJ3) && r10.instant_decline_until === null && r10.payment_status === "held" && /instant_book_unavailable/.test(err(reB)),
  err(bookJ3) || JSON.stringify(r10) + " " + err(reB));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
