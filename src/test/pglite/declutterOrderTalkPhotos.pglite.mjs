#!/usr/bin/env node
/**
 * PGlite proof for 20261112060000 (audit 11-10 F389): a photo on a Declutter order-chat message.
 *   - storage: the 'talk' folder of the private declutter-handover bucket. Write: own folder, a side of the order,
 *     chat open, not blocked, not banned. Read: the two sides; the other side's photo not across a block or a ban;
 *     an admin only on an order with a problem report. The older kinds keep their rules.
 *   - declutter_send_order_message(order, body, photo_path): the caller's own uploaded 'talk' object for THIS order,
 *     on no other message; a photo may go with no words; two-argument calls still work; the notice says "photo".
 *   - declutter_order_talk_view: each message's photo_path, null + photo_hidden for the other side across a block/ban.
 *
 *   node src/test/pglite/declutterOrderTalkPhotos.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterOrderTalkPhotos.pglite.mjs # RED
 *   MUTANT=<name> node ...                                                       # each must FAIL (see MUTANTS)
 *
 * World: the tables as 20261030004216 made them (cut down to the columns read), the PREVIOUS
 * declutter_handover_photo_access (20261030071818), declutter_order_talk_view (20261103050349) and
 * declutter_send_order_message (20261103055505), declutter_order_talk_until (20261030004216) and
 * declutter_names_hidden (20261112010100) read from their files. Stubbed, and said so: auth.uid() from a setting,
 * has_role / is_caller_banned / are_users_blocked from small tables, declutter_lock_order = SELECT ... FOR UPDATE,
 * declutter_notify writes a row, contact_leak_reason flags only '@', declutter_problem_window_open is false.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = readdirSync(MIG_DIR).find((f) => f.endsWith("_declutter_order_talk_photos.sql"));
if (!THIS) throw new Error("migration not found");
function fnFrom(file, head) {
  const t = readFileSync(MIG_DIR + file, "utf8");
  const s = t.indexOf(head);
  if (s < 0) throw new Error(`${head} not in ${file}`);
  const tag = t.slice(s).match(/\nAS (\$[a-z_]*\$)/)[1];
  const open = t.indexOf(`\nAS ${tag}`, s);
  return t.slice(s, t.indexOf(`${tag};`, open + tag.length + 4) + tag.length + 1);
}
const prevAccess = fnFrom("20261030071818_declutter_returns.sql", "CREATE OR REPLACE FUNCTION public.declutter_handover_photo_access(");
const prevView = fnFrom("20261103050349_declutter_orders_talk_admin_not_found_is_404.sql", "CREATE OR REPLACE FUNCTION public.declutter_order_talk_view(");
const prevSend = fnFrom("20261103055505_declutter_shops_homes_messages_not_found_is_404.sql", "CREATE OR REPLACE FUNCTION public.declutter_send_order_message(");
const until = fnFrom("20261030004216_declutter_order_talk.sql", "CREATE OR REPLACE FUNCTION public.declutter_order_talk_until(");
const prevUnattached = fnFrom("20261029222816_declutter_handover_photo_cleanup.sql", "CREATE OR REPLACE FUNCTION public.declutter_handover_photo_unattached(");
const namesHidden = fnFrom("20261112010100_declutter_names_hidden_across_block_or_ban.sql", "CREATE OR REPLACE FUNCTION public.declutter_names_hidden(");

const MUTANTS = {
  noBlockHideRead: ["AND NOT public.declutter_names_hidden(o.buyer_id, o.seller_id))))", ")))"],
  anyFolderWrite: ["      RETURN split_part(p_name, '/', 1) = v_uid::text\n         AND NOT public.is_caller_banned()", "      RETURN true\n         AND NOT public.is_caller_banned()"],
  closedChatWrite: ["                        AND public.declutter_order_talk_until(o.id) > now()\n", ""],
  blockedWrite: ["                        AND NOT public.are_users_blocked(o.buyer_id, o.seller_id));\n    END IF;", "                        );\n    END IF;"],
  bannedWrite: ["         AND NOT public.is_caller_banned()\n", ""],
  adminAnyOrder: ["            AND EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = v_order AND p.status <> 'withdrawn'));", "            );"],
  otherOrderPhoto: ["       OR split_part(p_photo_path, '/', 4) IS DISTINCT FROM o.id::text\n", ""],
  notUploaded: ["       OR NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'declutter-handover' AND so.name = p_photo_path)\n", ""],
  reusedPhoto: ["       OR EXISTS (SELECT 1 FROM public.declutter_order_talk_messages x WHERE x.photo_path = p_photo_path)) THEN", "       ) THEN"],
  unsentReadable: ["                               AND EXISTS (SELECT 1 FROM public.declutter_order_talk_messages m\n                                             JOIN public.declutter_order_talks t ON t.id = m.talk_id\n                                            WHERE m.photo_path = p_name AND t.order_id = o.id)\n", ""],
  adminWithdrawn: ["WHERE p.order_id = v_order AND p.status <> 'withdrawn'));", "WHERE p.order_id = v_order));"],
  deleteAttached: ["             AND NOT EXISTS (SELECT 1 FROM public.declutter_order_talk_messages m WHERE m.photo_path = p_name))),", "             )),"],
  viewNoHide: ["'photo_path', CASE WHEN m.sender_side <> v_side AND public.declutter_names_hidden(o.buyer_id, o.seller_id)\n                                               THEN NULL ELSE m.photo_path END,", "'photo_path', m.photo_path,"],
};
let mig = readFileSync(MIG_DIR + THIS, "utf8");
const MUTANT = process.env.MUTANT ?? "";
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || mig.split(m[0]).length !== 2) throw new Error(`mutant ${MUTANT} did not apply`);
  mig = mig.replace(m[0], m[1]);
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `11111111-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const SAM = U(1), ANN = U(2), EVE = U(3), ADM = U(4), BOB = U(5), CAL = U(6);
const O = (n) => `33333333-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
// O1 paid (open chat, Sam sells to Ann). O2 handed over 5 days ago (chat ended). O3 paid, with a problem report.
// O4 never paid. O5 paid, Bob sells to Cal (for block/ban cases without touching O1).
const db = await PGlite.create();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth; CREATE SCHEMA storage;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $f$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  CREATE TABLE storage.objects (bucket_id text, name text, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.user_roles (user_id uuid, role text);
  CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, ban_status text, auto_suspended_until timestamptz);
  CREATE TABLE public.notices (user_id uuid, kind text, title text, body text, link text);
  CREATE FUNCTION public.has_role(p uuid, r text) RETURNS boolean LANGUAGE sql STABLE AS
    $f$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p AND role = r) $f$;
  CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS
    $f$ SELECT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND ban_status = 'banned') $f$;
  CREATE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql STABLE AS
    $f$ SELECT EXISTS (SELECT 1 FROM public.user_blocks WHERE (blocker_id = a AND blocked_id = b) OR (blocker_id = b AND blocked_id = a)) $f$;
  CREATE FUNCTION public.contact_leak_reason(t text) RETURNS text LANGUAGE sql IMMUTABLE AS
    $f$ SELECT CASE WHEN t LIKE '%@%' THEN 'An email address' END $f$;
  CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, buyer_id uuid, seller_id uuid, status text, handover text,
    paid_at timestamptz, handed_over_at timestamptz, closed_at timestamptz);
  CREATE TABLE public.declutter_problems (order_id uuid, status text, decided_at timestamptz);
  CREATE TABLE public.declutter_refund_requests (order_id uuid, status text, updated_at timestamptz);
  CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, title text);
  CREATE TABLE public.declutter_handovers (order_id uuid, set_out_photo_path text, picked_up_photo_path text);
  CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, order_id uuid, created_at timestamptz DEFAULT now());
  CREATE FUNCTION public.declutter_problem_window_open(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT false $f$;
  CREATE FUNCTION public.declutter_order_side(p_buyer uuid, p_seller uuid, p_uid uuid) RETURNS text LANGUAGE sql IMMUTABLE AS
    $f$ SELECT CASE WHEN p_uid IS NULL THEN NULL WHEN p_buyer = p_uid THEN 'buyer' WHEN p_seller = p_uid THEN 'seller' END $f$;
  CREATE FUNCTION public.declutter_lock_order(p uuid) RETURNS public.declutter_orders LANGUAGE sql AS
    $f$ SELECT * FROM public.declutter_orders WHERE id = p FOR UPDATE $f$;
  CREATE FUNCTION public.declutter_notify(p_to uuid, p_kind text, p_title text, p_body text, p_link text, p_from uuid) RETURNS void LANGUAGE sql AS
    $f$ INSERT INTO public.notices VALUES (p_to, p_kind, p_title, p_body, p_link) $f$;
  CREATE TABLE IF NOT EXISTS public.declutter_order_talks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL UNIQUE REFERENCES public.declutter_orders(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(), buyer_notified_at timestamptz, seller_notified_at timestamptz);
  CREATE TABLE IF NOT EXISTS public.declutter_order_talk_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    talk_id uuid NOT NULL REFERENCES public.declutter_order_talks(id) ON DELETE CASCADE,
    sender_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    sender_side text NOT NULL CHECK (sender_side IN ('buyer', 'seller')),
    body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 1000),
    created_at timestamptz NOT NULL DEFAULT now());
  INSERT INTO auth.users VALUES ('${SAM}'), ('${ANN}'), ('${EVE}'), ('${ADM}'), ('${BOB}'), ('${CAL}');
  INSERT INTO public.user_roles VALUES ('${ADM}', 'admin');
  INSERT INTO public.declutter_orders VALUES
    ('${O(1)}', '${ANN}', '${SAM}', 'paid', 'pickup_home', now() - interval '1 day', NULL, NULL),
    ('${O(2)}', '${ANN}', '${SAM}', 'handed_over', 'pickup_home', now() - interval '6 days', now() - interval '5 days', now() - interval '5 days'),
    ('${O(3)}', '${ANN}', '${SAM}', 'paid', 'pickup_home', now() - interval '1 day', NULL, NULL),
    ('${O(4)}', '${ANN}', '${SAM}', 'reserved', 'pickup_home', NULL, NULL, NULL),
    ('${O(5)}', '${CAL}', '${BOB}', 'paid', 'pickup_home', now() - interval '1 day', NULL, NULL);
  INSERT INTO public.declutter_problems VALUES ('${O(3)}', 'decided', now() - interval '1 hour'), ('${O(5)}', 'withdrawn', now() - interval '1 hour');
  INSERT INTO public.declutter_items VALUES ('99999999-0000-0000-0000-000000000001', 'Oak chair');
  INSERT INTO public.declutter_cart_items (item_id, order_id) VALUES ('99999999-0000-0000-0000-000000000001', '${O(1)}');
  ${until}
  ${namesHidden}
  ${prevAccess}
  ${prevUnattached}
  ${prevView}
  ${prevSend}
`);

const runs = process.env.NEW_MIGRATION === "skip" ? 0 : 3;
let applyError = null;
for (let i = 0; i < runs; i++) {
  try { await db.exec(mig); } catch (e) { applyError = String(e.message ?? e); break; }
}
check(applyError === null, `applied ${THIS} x${runs} -> ${applyError ?? "ok"}`);

const as = async (uid) => db.exec(`SELECT set_config('request.jwt.claim.sub', '${uid}', false)`);
const access = async (uid, name, write) => {
  await as(uid);
  try { return (await db.query(`SELECT public.declutter_handover_photo_access($1, $2) AS ok`, [name, write])).rows[0].ok; }
  catch (e) { return `error: ${e.message}`; }
};
const send = async (uid, order, body, photo) => {
  await as(uid);
  try {
    const r = photo === undefined
      ? await db.query(`SELECT public.declutter_send_order_message($1::uuid, $2::text) AS id`, [order, body])
      : await db.query(`SELECT public.declutter_send_order_message($1::uuid, $2::text, $3::text) AS id`, [order, body, photo]);
    return { id: r.rows[0].id };
  } catch (e) { return { error: String(e.message ?? e) }; }
};
const view = async (uid, order) => {
  await as(uid);
  try { return (await db.query(`SELECT public.declutter_order_talk_view($1) AS v`, [order])).rows[0].v; }
  catch (e) { return { error: String(e.message ?? e) }; }
};
const talk = (uid, order, f = "a.jpg") => `${uid}/declutter/talk/${order}/${f}`;
const put = (name) => db.exec(`INSERT INTO storage.objects (bucket_id, name) VALUES ('declutter-handover', '${name}')`);

// Storage: write.
check((await access(ANN, talk(ANN, O(1)), true)) === true, "the buyer may upload a talk photo into her own folder while the chat is open");
check((await access(SAM, talk(SAM, O(1)), true)) === true, "the seller may too");
check((await access(ANN, talk(SAM, O(1)), true)) === false, "never into the other side's folder");
check((await access(EVE, talk(EVE, O(1)), true)) === false, "someone on neither side may not upload for the order");
check((await access(ANN, talk(ANN, O(2)), true)) === false, "not once the chat has ended (handed over 5 days ago)");
check((await access(ANN, talk(ANN, O(4)), true)) === false, "not on an order never paid");
// Storage: read.
check((await access(SAM, talk(ANN, O(1)), false)) === false, "the other side does NOT read a talk photo that was never sent");
check((await access(ANN, talk(ANN, O(1)), false)) === true, "the sender reads her own");
check((await access(EVE, talk(ANN, O(1)), false)) === false, "someone on neither side does not");
check((await access(ADM, talk(ANN, O(1)), false)) === false, "an admin does not, on an order with no problem report");
check((await access(ADM, talk(ANN, O(3)), false)) === true, "an admin does, on an order with a problem report");
check((await access(ADM, talk(CAL, O(5)), false)) === false, "an admin does not, when the order's only report was withdrawn");
check((await access(EVE, talk(EVE, O(1)), false)) === false, "a stranger's own-named folder on the order is not readable either");
// Older kinds unchanged.
check((await access(ADM, `${ANN}/declutter/handover/${O(1)}/h.jpg`, false)) === true, "a handover photo: admins still read it (unchanged)");
check((await access(ANN, `${ANN}/declutter/problem/${O(1)}/p.jpg`, true)) === true, "a problem photo: still uploadable on a paid order (unchanged)");
check((await access(ANN, `${ANN}/declutter/other/${O(1)}/p.jpg`, true)) === false, "an unknown kind is still refused");

// Send.
await put(talk(ANN, O(1)));
const s1 = await send(ANN, O(1), "  ", talk(ANN, O(1)));
check(!!s1.id, `a photo with no words sends -> ${s1.error ?? "ok"}`);
const row = await db.query(`SELECT body, photo_path FROM public.declutter_order_talk_messages WHERE id = $1`, [s1.id ?? null]).then((r) => r.rows[0], () => undefined);
check(row?.photo_path === talk(ANN, O(1)) && row?.body === "", "the message keeps the photo path and empty words");
check((await access(SAM, talk(ANN, O(1)), false)) === true, "once sent, the other side reads it");
const unattached = async (uid, name) => { await as(uid); try { return (await db.query(`SELECT public.declutter_handover_photo_unattached($1) AS ok`, [name])).rows[0].ok; } catch (e) { return `error: ${e.message}`; } };
check((await unattached(ANN, talk(ANN, O(1)))) === false, "a sent chat photo can not be deleted by its uploader");
check((await unattached(ANN, talk(ANN, O(1), "refused.jpg"))) === true, "an unsent chat photo (a refused send) can be deleted by its uploader");
check((await unattached(SAM, talk(ANN, O(1), "refused.jpg"))) === false, "never by the other side");
check((await unattached(ANN, `${ANN}/declutter/handover/${O(1)}/h.jpg`)) === true && (await unattached(ANN, `${ANN}/declutter/problem/${O(1)}/p.jpg`)) === false, "handover photos keep their rule, problem photos stay undeletable");
const note = (await db.query(`SELECT body FROM public.notices WHERE user_id = '${SAM}' ORDER BY body DESC LIMIT 1`)).rows[0];
check(/sent you a photo about "Oak chair"/.test(note?.body ?? ""), `the seller is told a photo came, not the photo -> ${note?.body}`);
const again = await send(ANN, O(1), "again", talk(ANN, O(1)));
check(/photo_not_uploaded/.test(again.error ?? ""), `the same photo on a second message is refused -> ${again.error ?? "sent"}`);
check(/photo_not_uploaded/.test((await send(ANN, O(1), "hi", talk(ANN, O(1), "missing.jpg"))).error ?? ""), "a photo never uploaded is refused");
await put(talk(ANN, O(3), "o3.jpg"));
check(/photo_not_uploaded/.test((await send(ANN, O(1), "hi", talk(ANN, O(3), "o3.jpg"))).error ?? ""), "a photo of another order is refused");
await put(talk(SAM, O(1), "sam.jpg"));
check(/photo_not_uploaded/.test((await send(ANN, O(1), "hi", talk(SAM, O(1), "sam.jpg"))).error ?? ""), "the other side's photo is refused");
await put(`${ANN}/declutter/problem/${O(1)}/p.jpg`);
check(/photo_not_uploaded/.test((await send(ANN, O(1), "hi", `${ANN}/declutter/problem/${O(1)}/p.jpg`)).error ?? ""), "a problem-folder photo is refused");
check(/invalid_message/.test((await send(ANN, O(1), "  ", null)).error ?? ""), "no words and no photo is refused");
const s2 = await send(SAM, O(1), "Not scratched, see?");
check(!!s2.id, `a two-argument call (older apps, manager mode) still sends -> ${s2.error ?? "ok"}`);
check(/check|violat/i.test((await (async () => { try { await db.exec(`INSERT INTO public.declutter_order_talk_messages (talk_id, sender_side, body) SELECT id, 'buyer', '' FROM public.declutter_order_talks LIMIT 1`); return "inserted"; } catch (e) { return String(e.message); } })())), "the table refuses a row with no words and no photo");

// View.
const vs = await view(SAM, O(1));
const m1 = vs.messages?.find((m) => m.id === s1.id);
check(m1?.photo_path === talk(ANN, O(1)) && m1?.photo_hidden === false && m1?.mine === false, `the seller's view carries the buyer's photo -> ${JSON.stringify(m1)}`);
check(vs.messages?.find((m) => m.id === s2.id)?.photo_path === null, "a text message reads photo_path null");

// Block and ban (O5: Bob sells to Cal).
await put(talk(CAL, O(5)));
const s5 = await send(CAL, O(5), "", talk(CAL, O(5)));
check(!!s5.id, `Cal sends a photo on O5 -> ${s5.error ?? "ok"}`);
await db.exec(`INSERT INTO public.user_blocks VALUES ('${BOB}', '${CAL}')`);
check((await access(BOB, talk(CAL, O(5)), false)) === false, "across a block, the other side's photo is not readable");
check((await access(CAL, talk(CAL, O(5)), false)) === true, "across a block, the sender still reads her own");
check((await access(CAL, talk(CAL, O(5), "b.jpg"), true)) === false, "across a block, no new upload");
const vb = await view(BOB, O(5));
const mb = vb.messages?.find((m) => m.id === s5.id);
check(mb?.photo_path === null && mb?.photo_hidden === true, `across a block, Bob's view hides Cal's photo -> ${JSON.stringify(mb)}`);
const vc = await view(CAL, O(5));
check(vc.messages?.find((m) => m.id === s5.id)?.photo_path === talk(CAL, O(5)), "Cal's own view keeps her photo");
await db.exec(`DELETE FROM public.user_blocks; INSERT INTO public.profiles VALUES ('${CAL}', 'banned', NULL)`);
check((await access(BOB, talk(CAL, O(5)), false)) === false, "a banned side's photo is not readable by the other side");
check((await access(CAL, talk(CAL, O(5), "c.jpg"), true)) === false, "a banned member may not upload");
await db.exec(`DELETE FROM public.profiles`);
check((await access(BOB, talk(CAL, O(5)), false)) === true, "with no block or ban the photo reads again");

const g = (await db.query(`SELECT has_function_privilege('anon', 'public.declutter_send_order_message(uuid, text, text)', 'EXECUTE') AS anon,
  has_function_privilege('authenticated', 'public.declutter_send_order_message(uuid, text, text)', 'EXECUTE') AS auth,
  (SELECT count(*)::int FROM pg_proc WHERE proname = 'declutter_send_order_message') AS n`)).rows[0];
check(g.anon === false && g.auth === true && g.n === 1, `send grants: anon no, authenticated yes, one signature -> ${JSON.stringify(g)}`);

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
