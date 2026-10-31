import { serve } from "../_shared/buildStamp.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { caughtMessage } from "../_shared/caughtMessage.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";

// SH2b (owner 2026-10-19): photos on the PUBLIC shop page, served by photo id.
//
// WHY THIS EXISTS: a shop photo's storage path is `<owner uid>/shops/<file>`
// (the job-photos bucket's owner-folder upload rule). Handing that path to a
// signed-out visitor hands them the owner's user id, and get_safe_profiles is
// anon-callable, so the link page would have told anyone who runs a home
// kitchen and roughly where they live (lh-authz-rls review of the first SH2b
// draft, must-fix 1). shops_public_shop therefore returns photo IDS only, and
// this function turns an id into the image without ever saying the path.
//
//   GET /functions/v1/shop-photo?id=<photo uuid>&kind=shop|item|declutter&w=<px>[&og=1]
//
// kind=declutter (Q2426, 20261027194426): a Declutter item's photo for its
// shared link card, while declutter_public_photo_path finds the item
// link-visible. Declutter photos live in the same job-photos bucket, at
// <seller uid>/declutter/<item id>/<file>, so the same reason applies.
//
// kind=job (GROW-6, 10-31): a public job's FIRST photo for its shared link
// card, asked by the JOB id (already in the shared URL). The photo URL lives in
// jobs.photos and starts with the poster's user id, so the card never names it.
// Served only while open_jobs_browse (the guest page's own public view) still
// has the job, and only a photo in this project's job-photos bucket.
//
// It serves a photo only while its shop passes shop_link_visible (not hidden,
// not paused, owner in good standing, Shops not switched off), and an item
// photo only while the item is live and the shop sells: the same rule as the
// page. Anything else is a 404, one answer for every refusal.
//
// verify_jwt is false in config.toml BY NECESSITY: an <img> sends no
// Authorization header, and the page is for signed-out visitors. So it is
// rate limited per server-derived address (_shared/rate-limit.ts). A full
// shop page can ask for over a hundred images in one burst (cover, logo,
// gallery, every live item's photo; lead review counted ~114), and an <img>
// carries no token,
// so the narrow window IS the address: 1200 a minute lets a visitor scroll
// several shops back to back, and the wide window (6000, every subject one
// address presents) still stops a loop from turning it into an egress pump.
const RATE = { windowMs: 60_000, maxRequests: 1200, ipMaxRequests: 6000, keyPrefix: "shop-photo" } as const;

// The un-resized fallback (render refused) is capped: never for a link card
// (og=1 declares 1200x630 image/jpeg, which an original is not), and never a
// body over 2 MB, so an outage of the transform add-on cannot turn this into
// an egress pump or hand out a full-size original.
const FALLBACK_MAX_BYTES = 2 * 1024 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WIDTHS = [160, 320, 640, 1200];
// The link-preview card (api/share.ts shopImage) asks og=1 and declares the
// size it gets: 1200x630 for a cover, 630x630 for a logo (w=630). Exactly
// those, never the nearest WIDTHS step, so og:image:width/height are true.
// Its type is image/jpeg: every shop photo is a JPEG (cleanListingPhoto
// re-encodes to a metadata-free JPEG), the render URL asks format=origin so
// storage keeps that JPEG instead of answering WebP to a browser that accepts
// it (measured 2026-10-19: no format -> image/webp, format=origin -> image/jpeg;
// format=jpeg is refused 400), and an og=1 answer that is not image/jpeg is
// refused rather than served under a card that says it is.
const OG_HEIGHT = 630;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
// Module level: one client per isolate, not one per image.
const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
  auth: { persistSession: false },
});

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "public, max-age=60" } });
}

// Storage answered neither the resized nor a servable original: the photo
// exists (the lookup found its path), so every visitor sees a broken image.
// One Slack alert a day, not one per image. Deduped HERE, per isolate (24 h), before
// postSlackOpsAlert writes its ledger row (it writes one per call even when
// oncePerDayKey then suppresses the post), and fired without awaiting so a
// failing page never waits on Slack.
type EdgeRuntimeLike = { waitUntil?: (p: Promise<unknown>) => void };
let lastAlertAt = 0;
const ALERT_EVERY_MS = 24 * 60 * 60 * 1000;

function alertStorage(status: number, why: string): void {
  const now = Date.now();
  if (now - lastAlertAt < ALERT_EVERY_MS) return;
  lastAlertAt = now;
  const run = postSlackOpsAlert({
    kind: "custom",
    severity: "warning",
    title: "Public shop photos are failing",
    message: `shop-photo: ${why} (storage answered ${status}) for a link-visible shop photo.`,
    oncePerDayKey: "shop-photo-storage",
  }).catch((err) => {
    // Logged, not thrown: the visitor already has their 502.
    console.error("shop-photo: alert failed", caughtMessage(err));
  });
  const rt = (globalThis as { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(run);
}

function unavailable(): Response {
  return new Response("Unavailable", { status: 502 });
}

serve(async (req: Request) => {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const askedKind = url.searchParams.get("kind");
  const kind = askedKind === "item" ? "item" : askedKind === "declutter" ? "declutter" : askedKind === "job" ? "job" : "shop";
  const og = url.searchParams.get("og") === "1";
  const asked = Number(url.searchParams.get("w") ?? 640);
  const width = og ? (asked === OG_HEIGHT ? OG_HEIGHT : 1200) : (WIDTHS.find((w) => w >= asked) ?? 1200);
  if (!UUID_RE.test(id)) return notFound();

  const rl = await checkRateLimit(req, RATE);
  if (!rl.allowed) {
    return new Response("Too many requests", { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
  }

  try {
    // Q2426: a shared Declutter item's link card asks kind=declutter. Same proxy, its own visibility rule
    // (declutter_item_link_visible: live or reserved, seller not out, Declutter not switched off).
    const { data, error } =
      kind === "job"
        ? await publicJobPhotoPath(id)
        : kind === "declutter"
        ? await admin.rpc("declutter_public_photo_path", { p_photo_id: id })
        : await admin.rpc("shops_public_photo_path", { p_photo_id: id, p_kind: kind });
    if (error) {
      console.error("shop-photo: lookup failed", error.code, error.message);
      return new Response("Unavailable", { status: 503 });
    }
    const path = typeof data === "string" ? data : null;
    if (!path) return notFound();
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const size = og ? `width=${width}&height=${OG_HEIGHT}&resize=cover` : `width=${width}&resize=contain`;
    // Resized through the image-transform endpoint (enabled on prod: measured
    // 200 2026-10-19), format=origin so the JPEG stays a JPEG.
    let upstream = await fetch(
      `${SUPABASE_URL}/storage/v1/render/image/public/job-photos/${encoded}?${size}&quality=80&format=origin`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!upstream.ok || !upstream.body) {
      console.error("shop-photo: render answered", upstream.status);
      await upstream.body?.cancel();
      // A link card never gets the original (wrong size, possibly not a
      // JPEG): refuse, and the preview shows no image rather than a lie.
      if (og) {
        alertStorage(upstream.status, "render refused a link-card image");
        return unavailable();
      }
      upstream = await fetch(`${SUPABASE_URL}/storage/v1/object/public/job-photos/${encoded}`, {
        signal: AbortSignal.timeout(8000),
      });
      const length = Number(upstream.headers.get("Content-Length") ?? NaN);
      if (upstream.ok && upstream.body && !(length > 0 && length <= FALLBACK_MAX_BYTES)) {
        console.error("shop-photo: original is", upstream.headers.get("Content-Length") ?? "of unknown size", "- not served un-resized");
        await upstream.body.cancel();
        alertStorage(upstream.status, "render refused and the original is over 2 MB or unsized");
        return unavailable();
      }
    }
    if (!upstream.ok || !upstream.body) {
      console.error("shop-photo: storage answered", upstream.status);
      await upstream.body?.cancel();
      alertStorage(upstream.status, "render and object both refused");
      return unavailable();
    }
    const type = upstream.headers.get("Content-Type") ?? "image/jpeg";
    if (og && !type.startsWith("image/jpeg")) {
      console.error("shop-photo: link-card image came back", type);
      await upstream.body.cancel();
      return unavailable();
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": type,
        // Short: a photo removed, or a shop hidden or paused, stops showing
        // within minutes, not days.
        "Cache-Control": "public, max-age=300",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    console.error("shop-photo: failed", caughtMessage(err));
    return new Response("Unavailable", { status: 503 });
  }
});

// Below the handler on purpose: read only at request time, after the module has loaded.
const JOB_PHOTO_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/job-photos/`;

/**
 * GROW-6: the storage path of a public job's first photo, or null. The job must still be in
 * open_jobs_browse (open, not ownerless, the guest page's own rule), and the photo a public URL in this
 * project's job-photos bucket; anything else (another host, a data: URI, an empty list) is null = 404.
 */
async function publicJobPhotoPath(jobId: string): Promise<{ data: string | null; error: { code?: string; message: string } | null }> {
  const { data, error } = await admin.from("open_jobs_browse").select("photos").eq("id", jobId).maybeSingle();
  if (error) return { data: null, error };
  const photos = (data as { photos?: unknown } | null)?.photos;
  const first = Array.isArray(photos) ? photos.find((p): p is string => typeof p === "string" && p.length > 0) : undefined;
  if (!first || !first.startsWith(JOB_PHOTO_PREFIX)) return { data: null, error: null };
  const raw = first.slice(JOB_PHOTO_PREFIX.length).split(/[?#]/)[0];
  try {
    const path = raw.split("/").map(decodeURIComponent).join("/");
    return { data: path && !path.split("/").includes("..") ? path : null, error: null };
  } catch {
    // A malformed %-escape: not a photo we can name, so the one 404 answer.
    return { data: null, error: null };
  }
}
