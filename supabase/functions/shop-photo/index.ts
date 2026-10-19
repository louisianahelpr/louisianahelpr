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
//   GET /functions/v1/shop-photo?id=<photo uuid>&kind=shop|item&w=<px>[&og=1]
//
// It serves a photo only while its shop passes shop_link_visible (not hidden,
// not paused, owner in good standing, Shops not switched off), and an item
// photo only while the item is live and the shop sells: the same rule as the
// page. Anything else is a 404, one answer for every refusal.
//
// verify_jwt is false in config.toml BY NECESSITY: an <img> sends no
// Authorization header, and the page is for signed-out visitors. So it is
// rate limited per server-derived address (_shared/rate-limit.ts): a full
// shop page is up to ~40 images, so 300 a minute never bites a real visitor
// but stops a loop from turning it into a storage-egress pump.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WIDTHS = [160, 320, 640, 1200];
// The link-preview card (api/share.ts shopImage) asks og=1 and declares the
// size it gets: 1200x630 for a cover, 630x630 for a logo (w=630). Exactly
// those, never the nearest WIDTHS step, so og:image:width/height are true.
// Its type is image/jpeg because every shop photo is: cleanListingPhoto
// refuses anything it cannot re-encode to a metadata-free JPEG.
const OG_HEIGHT = 630;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
// Module level: one client per isolate, not one per image.
const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
  auth: { persistSession: false },
});

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "public, max-age=60" } });
}

// Storage answered neither the resized nor the original image: the photo
// exists (the lookup found its path), so every visitor sees a broken image.
// One Slack alert a day, not one per image.
async function alertStorage(status: number): Promise<void> {
  try {
    await postSlackOpsAlert({
      kind: "custom",
      severity: "warning",
      title: "Public shop photos are failing",
      message: `shop-photo: storage answered ${status} for a link-visible shop photo (render and object both refused).`,
      oncePerDayKey: "shop-photo-storage",
    });
  } catch (err) {
    console.error("shop-photo: alert failed", caughtMessage(err));
  }
}

serve(async (req: Request) => {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const kind = url.searchParams.get("kind") === "item" ? "item" : "shop";
  const og = url.searchParams.get("og") === "1";
  const asked = Number(url.searchParams.get("w") ?? 640);
  const width = og ? (asked === OG_HEIGHT ? OG_HEIGHT : 1200) : (WIDTHS.find((w) => w >= asked) ?? 1200);
  if (!UUID_RE.test(id)) return notFound();

  const rl = await checkRateLimit(req, { windowMs: 60_000, maxRequests: 300, ipMaxRequests: 300, keyPrefix: "shop-photo" });
  if (!rl.allowed) {
    return new Response("Too many requests", { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
  }

  try {
    const { data, error } = await admin.rpc("shops_public_photo_path", { p_photo_id: id, p_kind: kind });
    if (error) {
      console.error("shop-photo: lookup failed", error.code, error.message);
      return new Response("Unavailable", { status: 503 });
    }
    const path = typeof data === "string" ? data : null;
    if (!path) return notFound();
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const size = og ? `width=${width}&height=${OG_HEIGHT}&resize=cover` : `width=${width}&resize=contain`;
    // Resized through the image-transform endpoint (enabled on prod: measured
    // 200 image/jpeg 2026-10-19). If it refuses (the add-on off, a format it
    // cannot read), fall back to the original object rather than a broken image.
    let upstream = await fetch(`${SUPABASE_URL}/storage/v1/render/image/public/job-photos/${encoded}?${size}&quality=80`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!upstream.ok || !upstream.body) {
      console.error("shop-photo: render answered", upstream.status, "- serving the original");
      await upstream.body?.cancel();
      upstream = await fetch(`${SUPABASE_URL}/storage/v1/object/public/job-photos/${encoded}`, {
        signal: AbortSignal.timeout(8000),
      });
    }
    if (!upstream.ok || !upstream.body) {
      console.error("shop-photo: storage answered", upstream.status);
      await alertStorage(upstream.status);
      return new Response("Unavailable", { status: 502 });
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "image/jpeg",
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
