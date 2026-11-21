/**
 * Runs api/og-item.ts once in a plain Node process for src/test/declutterOgItemCard.test.ts (jsdom's typed arrays are
 * another realm and resvg refuses them), as ogProfileRun.mjs does for og-profile. Reads one scenario as JSON on stdin,
 * answers fetch from it, and prints one JSON line: the response status, headers, body (base64) and every URL fetched.
 * No network: every fetch the scenario does not name throws (a data: URL, the renderer's own wasm, is not network).
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const sc = JSON.parse(readFileSync(0, "utf8"));
process.env.VITE_SUPABASE_URL = sc.sb;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "anon-key";
const photo = Buffer.from(sc.photo, "base64");
const fetched = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith("data:")) return realFetch(url, init);
  fetched.push(u);
  if (u.endsWith("/rest/v1/rpc/declutter_public_item_card")) return new Response(JSON.stringify(sc.answer), { status: sc.rpcStatus, headers: { "Content-Type": "application/json" } });
  if (u.startsWith(`${sc.sb}/functions/v1/shop-photo?`)) return new Response(photo, { status: 200, headers: { "Content-Type": sc.photoType } });
  throw new Error(`unexpected fetch ${u}`);
};
const og = (await import(pathToFileURL(sc.fn).href)).default;
const res = await og.fetch(new Request(`https://www.louisianahelpr.com/api/og-item${sc.query}`));
const body = Buffer.from(await res.arrayBuffer());
process.stdout.write(`${JSON.stringify({ status: res.status, headers: Object.fromEntries(res.headers), png: body.toString("base64"), fetched })}\n`);
