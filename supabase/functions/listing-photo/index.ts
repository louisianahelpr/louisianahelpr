import { serve } from "../_shared/buildStamp.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { caughtMessage } from "../_shared/caughtMessage.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { isJpeg, stripJpegMetadata } from "../_shared/jpegStripMetadata.ts";

// Homes listing photos, served by signed photo ref (Q2211, Q2212, Q2213).
//
// WHY THIS EXISTS: listing photos live in the PRIVATE listing-photos bucket at
// <owner uid>/rental-listings/<listing id>/<file> (20261019071203). That path
// names the landlord's account, and a public bucket kept a taken-down
// listing's photos online forever. So no read hands out a path any more:
// every read (Rent and Buy browse, the listing page, the owner's editor, the
// public /r/ link) returns REFS, "<photo id>.<scope>.<exp>.<sig>", signed in
// the database. This function turns a ref into the image:
//
//   GET /functions/v1/listing-photo?r=<ref>&w=<px>
//
// rentals_listing_photo_object (service_role only) checks the signature and
// expiry and re-checks the ref's rule on EVERY fetch (p: the listing is public;
// m: it is visible to members; o: its owner has not removed it, and no admin
// took it down). Anything else is a 404, one answer for every refusal.
//
// Q2212: the image is re-encoded by Storage's renderer (format=origin, so the
// JPEG stays a JPEG) and then stripped of every metadata segment
// (_shared/jpegStripMetadata.ts) before it is served, the capped original
// fallback included: no EXIF/GPS leaves the server, whatever was uploaded.
// Bytes that are not a well-formed JPEG are refused, never served as is.
//
// verify_jwt is false in config.toml BY NECESSITY: an <img> sends no
// Authorization header, and the /r/ page is for signed-out visitors. The ref
// is the capability (it expires within two hours), and the function is rate
// limited per server-derived address (_shared/rate-limit.ts): a browse page
// asks for up to 30 cards' covers and a listing page 25 photos at once, so the
// narrow window is generous, and the wide window (every subject one address
// presents) still stops a loop from turning it into an egress pump.
const RATE = { windowMs: 60_000, maxRequests: 600, ipMaxRequests: 3000, keyPrefix: "listing-photo" } as const;

// The un-resized fallback (render refused) is capped: never a body over 2 MB,
// so an outage of the transform add-on cannot turn this into an egress pump.
const FALLBACK_MAX_BYTES = 2 * 1024 * 1024;
// A rendered image is at most 1200 px wide at quality 80; anything bigger than
// this is not what was asked for.
const RENDER_MAX_BYTES = 4 * 1024 * 1024;

const REF_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[pmo]\.[0-9]{10}\.[0-9a-f]{32}$/;
const WIDTHS = [160, 320, 640, 1200];
const BUCKET = "listing-photos";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// Module level: one client per isolate, not one per image.
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}

function unavailable(): Response {
  return new Response("Unavailable", { status: 502, headers: { "Cache-Control": "no-store" } });
}

// Storage answered neither the resized nor a servable original for a photo the
// lookup found: every visitor sees a broken image. One Slack alert a day per
// isolate, fired without awaiting so a failing page never waits on Slack.
type EdgeRuntimeLike = { waitUntil?: (p: Promise<unknown>) => void };
let lastAlertDay = "";

function alertStorage(status: number, why: string): void {
  const day = new Date().toISOString().slice(0, 10);
  if (lastAlertDay === day) return;
  lastAlertDay = day;
  const run = postSlackOpsAlert({
    kind: "custom",
    severity: "warning",
    title: "Homes listing photos are failing",
    message: `listing-photo: ${why} (storage answered ${status}) for a visible listing photo.`,
    oncePerDayKey: "listing-photo-storage",
  }).catch((err) => {
    // Logged, not thrown: the visitor already has their 502.
    console.error("listing-photo: alert failed", caughtMessage(err));
  });
  const rt = (globalThis as { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(run);
}

/** Reads a body up to `max` bytes; null when it is longer (the rest is cancelled). */
async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get("Content-Length") ?? NaN);
  if (declared > max) {
    await res.body?.cancel();
    return null;
  }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const storageHeaders = () => ({ Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY });

serve(async (req: Request) => {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  const url = new URL(req.url);
  const ref = url.searchParams.get("r") ?? "";
  const asked = Number(url.searchParams.get("w") ?? 640);
  const width = WIDTHS.find((w) => w >= asked) ?? 1200;
  if (!REF_RE.test(ref)) return notFound();

  // Rate limited by ADDRESS only: an unverified bearer must not pick its own bucket (lead review of Q2211 #1,
  // the instant-job-match pattern). An <img> sends none anyway.
  const addressOnly = new Headers(req.headers);
  addressOnly.delete("authorization");
  const rl = await checkRateLimit(new Request(req.url, { method: req.method, headers: addressOnly }), RATE);
  if (!rl.allowed) {
    return new Response("Too many requests", { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
  }

  try {
    const { data, error } = await admin.rpc("rentals_listing_photo_object", { p_ref: ref });
    if (error) {
      // A lookup failure is ours, not the visitor's: logged, 503 (never a silent 404).
      console.error("listing-photo: lookup failed", error.code, error.message);
      return new Response("Unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    const path = typeof data === "string" ? data : null;
    if (!path) return notFound();
    const encoded = path.split("/").map(encodeURIComponent).join("/");

    // Re-encoded by the image-transform endpoint (the authenticated route: the
    // bucket is private), format=origin so the JPEG stays a JPEG.
    let bytes: Uint8Array | null = null;
    const rendered = await fetch(
      `${SUPABASE_URL}/storage/v1/render/image/authenticated/${BUCKET}/${encoded}?width=${width}&resize=contain&quality=80&format=origin`,
      { headers: storageHeaders(), signal: AbortSignal.timeout(8000) },
    );
    if (rendered.ok) {
      bytes = await readCapped(rendered, RENDER_MAX_BYTES);
      if (!bytes) console.error("listing-photo: render answered over", RENDER_MAX_BYTES, "bytes");
    } else {
      console.error("listing-photo: render answered", rendered.status);
      await rendered.body?.cancel();
    }
    // A public-link ref (scope p) is served RE-ENCODED only, never the original (lead review of Q2211 #7).
    if (!bytes && ref.split(".")[1] === "p") {
      alertStorage(rendered.status, "render refused a public-link photo (no original fallback for strangers)");
      return unavailable();
    }
    if (!bytes) {
      const original = await fetch(`${SUPABASE_URL}/storage/v1/object/authenticated/${BUCKET}/${encoded}`, {
        headers: storageHeaders(),
        signal: AbortSignal.timeout(8000),
      });
      if (!original.ok) {
        console.error("listing-photo: storage answered", original.status);
        await original.body?.cancel();
        alertStorage(original.status, "render and object both refused");
        return unavailable();
      }
      bytes = await readCapped(original, FALLBACK_MAX_BYTES);
      if (!bytes) {
        console.error("listing-photo: original is over", FALLBACK_MAX_BYTES, "bytes - not served un-resized");
        alertStorage(original.status, "render refused and the original is over 2 MB");
        return unavailable();
      }
    }

    // Q2212: no metadata leaves the server. Not a JPEG, or not a well-formed one: refused.
    const clean = isJpeg(bytes) ? stripJpegMetadata(bytes) : null;
    if (!clean) {
      console.error("listing-photo: storage returned bytes that are not a well-formed JPEG");
      return unavailable();
    }
    return new Response(req.method === "HEAD" ? null : clean, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(clean.byteLength),
        // Short and private: a paused or taken-down listing stops showing within
        // minutes, and no shared cache keeps a member's photo.
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    console.error("listing-photo: failed", caughtMessage(err));
    return new Response("Unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
});
