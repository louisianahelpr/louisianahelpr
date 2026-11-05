import { serve } from "../_shared/buildStamp.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { caughtMessage } from "../_shared/caughtMessage.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { stripWebpMetadata } from "../_shared/webpStripMetadata.ts";

// Job photos on a member's public page, served by pick id (owner 11-05, share-profile H4).
//
// WHY THIS EXISTS: job after photos live in the PRIVATE proof-photos bucket at paths that name a job or a member,
// and they are often taken inside someone's home. A Helpr may put one on their /u/<handle> page only when the
// poster AND every Helpr booked on that job allow sharing ("Let Helpr share my job photos") AND the Helpr ticked
// that photo (20261105172514_profile_job_photos.sql). The page read hands out a random pick id, never a path:
//
//   GET /functions/v1/profile-work-photo?id=<pick id>&w=<px>
//
// profile_work_photo_object (service_role only) re-checks every rule on EVERY fetch, so a photo stops showing as
// soon as anyone turns sharing off, the Helpr un-ticks it, or their page is no longer public. Anything else is a
// 404, one answer for every refusal.
//
// The image is always re-encoded by Storage's renderer as WebP (Accept: image/webp, no format=origin), then every
// EXIF / XMP chunk is dropped (_shared/webpStripMetadata.ts) before it is served: no camera location leaves the
// server. There is no un-resized fallback; bytes that are not a well-formed WebP are refused.
//
// verify_jwt is false in config.toml BY NECESSITY: an <img> sends no Authorization header and the page is for
// signed-out visitors. Rate limited per server-derived address (_shared/rate-limit.ts).
const RATE = { windowMs: 60_000, maxRequests: 300, ipMaxRequests: 1500, keyPrefix: "profile-work-photo" } as const;
const RENDER_MAX_BYTES = 4 * 1024 * 1024;
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WIDTHS = [160, 320, 640, 1200];
const BUCKET = "proof-photos";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}

function unavailable(): Response {
  return new Response("Unavailable", { status: 502, headers: { "Cache-Control": "no-store" } });
}

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

serve(async (req: Request) => {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  const url = new URL(req.url);
  const id = (url.searchParams.get("id") ?? "").toLowerCase();
  const asked = Number(url.searchParams.get("w") ?? 640);
  const width = WIDTHS.find((w) => w >= asked) ?? 1200;
  if (!ID_RE.test(id)) return notFound();

  // Rate limited by ADDRESS only: an unverified bearer must not pick its own bucket (the listing-photo rule).
  const addressOnly = new Headers(req.headers);
  addressOnly.delete("authorization");
  const rl = await checkRateLimit(new Request(req.url, { method: req.method, headers: addressOnly }), RATE);
  if (!rl.allowed) {
    return new Response("Too many requests", { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
  }

  try {
    const { data, error } = await admin.rpc("profile_work_photo_object", { p_pick_id: id });
    if (error) {
      console.error("profile-work-photo: lookup failed", error.code, error.message);
      return new Response("Unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    const path = typeof data === "string" ? data : null;
    if (!path) return notFound();
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const rendered = await fetch(
      `${SUPABASE_URL}/storage/v1/render/image/authenticated/${BUCKET}/${encoded}?width=${width}&resize=contain&quality=75`,
      { headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, Accept: "image/webp" }, signal: AbortSignal.timeout(8000) },
    );
    if (!rendered.ok) {
      console.error("profile-work-photo: render answered", rendered.status);
      await rendered.body?.cancel();
      return unavailable();
    }
    const bytes = await readCapped(rendered, RENDER_MAX_BYTES);
    const clean = bytes ? stripWebpMetadata(bytes) : null;
    if (!clean) {
      console.error("profile-work-photo: render returned no well-formed WebP under the cap");
      return unavailable();
    }
    return new Response(req.method === "HEAD" ? null : new Uint8Array(clean), {
      status: 200,
      headers: {
        "Content-Type": "image/webp",
        "Content-Length": String(clean.byteLength),
        // Short and private: a photo whose sharing was turned off stops showing within minutes.
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    console.error("profile-work-photo: failed", caughtMessage(err));
    return new Response("Unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
});
