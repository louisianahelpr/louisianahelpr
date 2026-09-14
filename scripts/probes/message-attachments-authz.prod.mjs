// PROD probe: message-attachments authz + voice notes (20260914200051).
//
//   node scripts/probes/message-attachments-authz.prod.mjs
//
// Runs against prod (there is no staging) as the poster-e2e (A) and helper-e2e
// (B) seed accounts, through the real Storage API and PostgREST with their own
// sessions. ~25 paced requests. Everything it creates (a few tiny objects and
// messages whose content starts "SEED authz proof") is removed in `finally`
// with the service role, and residue is checked. Exit 1 on any unmet
// expectation, so it reads RED on the policies before the migration and GREEN
// after it.
//
//   J1 = A's job (A is the poster); J2 = B's job, which A is not a party to.
//   1. A uploads J1/A/<file>. B inserts a message in J2 naming that path and
//      tries to sign it. EXPECT: the insert is refused; and even a forged row
//      written by the service role (as if left over from before) grants B no
//      read.
//   2. A's own message with A's own attachment still inserts and A can sign it.
//   3. A uploads voice-notes/J1/A/<uuid>.webm (audio/webm;codecs=opus) and .m4a
//      (audio/mp4), sends it as a message, then deletes the object through the
//      Storage API (the message-delete flow removes the file before the row).
//      EXPECT: upload 200, delete leaves no object.
//   4. A plants into voice-notes/J2/B/. EXPECT: refused.
import crypto from "node:crypto";
import { URL_, ANON, readEnv, session } from "./lib/prodEnv.mjs";

const SR = readEnv().SUPABASE_SERVICE_ROLE_KEY;
const A_ID = "71c56dfb-b326-4010-b960-b18dd3966e7f", J1 = "e8cabaca-87ac-4fa0-95e4-b33179e05d6e";
const B_ID = "437de07d-1bd7-46c8-a451-6b46aa3bcad5", J2 = "63bf6243-b1a6-55b9-ad4e-d6cae05df6bc";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (s) => String(s).replace(/\b([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "$1…");

async function call(method, url, tok, body, headers = {}) {
  await sleep(350);
  const res = await fetch(`${URL_}${url}`, { method, headers: { apikey: tok === SR ? SR : ANON, Authorization: `Bearer ${tok}`, ...headers }, body });
  return { status: res.status, text: await res.text() };
}
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");
const json = { "Content-Type": "application/json" };
const upload = (tok, p, type, body = PNG) => call("POST", `/storage/v1/object/message-attachments/${p}`, tok, body, { "Content-Type": type, "x-upsert": "false" });
const sign = (tok, p) => call("POST", `/storage/v1/object/sign/message-attachments/${p}`, tok, JSON.stringify({ expiresIn: 60 }), json);
const removeObj = (tok, p) => call("DELETE", `/storage/v1/object/message-attachments`, tok, JSON.stringify({ prefixes: [p] }), json);
const insertMsg = (tok, row) => call("POST", `/rest/v1/messages?select=id`, tok, JSON.stringify({ attachment_mime: "image/png", attachment_size: PNG.length, ...row }), { ...json, Prefer: "return=representation" });
const objectExists = async (p) => (await call("GET", `/storage/v1/object/authenticated/message-attachments/${p}`, SR)).status === 200;

let failures = 0;
const check = (name, cond, detail) => { if (!cond) failures++; console.log(`${cond ? "  ok " : "FAIL "} ${name}${detail ? `  [${short(detail).slice(0, 140)}]` : ""}`); };
const paths = [], msgs = [];
const track = (r, p) => { if (r.status === 200) paths.push(p); return r; };
const trackMsg = (r) => { if (r.status === 201) msgs.push(JSON.parse(r.text)[0].id); return r; };

const tA = session("poster-e2e").access_token;
const tB = session("helper-e2e").access_token;
try {
  const aPath = `${J1}/${A_ID}/${crypto.randomUUID()}-authz-proof.png`;
  let r = track(await upload(tA, aPath, "image/png"), aPath);
  check("A uploads own attachment", r.status === 200, `${r.status} ${r.text}`);
  r = await sign(tB, aPath);
  check("control: B cannot sign A's path with no message", r.status !== 200, `${r.status}`);
  r = trackMsg(await insertMsg(tB, { job_id: J2, sender_id: B_ID, receiver_id: B_ID, content: "SEED authz proof forged", attachment_url: aPath }));
  check("B's message naming A's path is refused", r.status !== 201, `${r.status} ${r.text}`);
  if (r.status !== 201) {
    const legacy = trackMsg(await call("POST", `/rest/v1/messages?select=id`, SR, JSON.stringify({ job_id: J2, sender_id: B_ID, receiver_id: B_ID, content: "SEED authz proof forged legacy row", attachment_url: aPath }), { ...json, Prefer: "return=representation" }));
    check("setup: service role writes a forged legacy row", legacy.status === 201, `${legacy.status} ${legacy.text}`);
  }
  r = await sign(tB, aPath);
  let leaked = false;
  if (r.status === 200) {
    await sleep(350);
    const bytes = Buffer.from(await (await fetch(`${URL_}/storage/v1${JSON.parse(r.text).signedURL}`)).arrayBuffer());
    leaked = bytes.equals(PNG);
  }
  check("B cannot sign/download A's file through a forged row", r.status !== 200, `sign ${r.status}${leaked ? ", downloaded bytes EQUAL A's upload" : ""}`);

  r = trackMsg(await insertMsg(tA, { job_id: J1, sender_id: A_ID, receiver_id: A_ID, content: "SEED authz proof own", attachment_url: aPath }));
  check("A's own message with own attachment inserts", r.status === 201, `${r.status} ${r.text}`);
  r = await sign(tA, aPath);
  check("A signs own attachment", r.status === 200, `${r.status}`);

  for (const [ext, mime, magic] of [["webm", "audio/webm;codecs=opus", "1a45dfa3"], ["m4a", "audio/mp4", "00000018667479706d703432"]]) {
    const v = `voice-notes/${J1}/${A_ID}/${crypto.randomUUID()}.${ext}`;
    r = track(await upload(tA, v, mime, Buffer.from(magic, "hex")), v);
    check(`A uploads voice note (${mime})`, r.status === 200, `${r.status} ${r.text}`);
    if (r.status !== 200) continue;
    r = trackMsg(await insertMsg(tA, { job_id: J1, sender_id: A_ID, receiver_id: A_ID, content: "SEED authz proof voice", attachment_url: v, attachment_mime: mime, attachment_size: magic.length / 2 }));
    check(`A sends the voice note as a message (${ext})`, r.status === 201, `${r.status} ${r.text}`);
    r = await sign(tA, v);
    check(`A signs own voice note (${ext})`, r.status === 200, `${r.status}`);
    r = await removeObj(tA, v);
    const still = await objectExists(v);
    check(`A deletes own voice note (${ext})`, !still, `${r.status} ${r.text}`);
    if (!still) paths.splice(paths.indexOf(v), 1);
  }
  const plant = `voice-notes/${J2}/${B_ID}/${crypto.randomUUID()}.webm`;
  r = track(await upload(tA, plant, "audio/webm"), plant);
  check("A cannot plant into B's voice-notes folder", r.status !== 200, `${r.status} ${r.text}`);
} finally {
  for (const id of msgs) {
    const d = await call("DELETE", `/rest/v1/messages?id=eq.${id}`, SR, undefined, { Prefer: "return=minimal" });
    if (d.status !== 204) console.log(`cleanup message ${short(id)} -> ${d.status}`);
  }
  if (paths.length) await call("DELETE", `/storage/v1/object/message-attachments`, SR, JSON.stringify({ prefixes: paths }), json);
  const residueMsgs = JSON.parse((await call("GET", `/rest/v1/messages?select=id&content=like.SEED%20authz%20proof*`, SR)).text);
  const residueObjs = [];
  for (const p of paths) if (await objectExists(p)) residueObjs.push(p);
  console.log(`cleanup: ${msgs.length} messages, ${paths.length} objects removed; residue messages ${residueMsgs.length}, objects ${residueObjs.length}`);
  if (residueMsgs.length || residueObjs.length) failures++;
}
console.log(failures ? `\nRED: ${failures} expectation(s) unmet` : "\nGREEN: all expectations met");
process.exit(failures ? 1 : 0);
