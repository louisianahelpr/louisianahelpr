import { serve } from "../_shared/buildStamp.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { caughtMessage } from "../_shared/caughtMessage.ts";

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
//   GET /functions/v1/shop-photo?id=<photo uuid>&kind=shop|item&w=<px>
//
// It serves a photo only while its shop passes shop_link_visible (not hidden,
// not paused, owner in good standing and switched on), and an item photo only
// while the item is live and the shop sells: the same rule as the page.
// Anything else is a 404, one answer for every refusal.
//
// verify_jwt is false in config.toml BY NECESSITY: an <img> sends no
// Authorization header, and the page is for signed-out visitors.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WIDTHS = [160, 320, 640, 1200];

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "public, max-age=60" } });
}

serve(async (req: Request) => {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const kind = url.searchParams.get("kind") === "item" ? "item" : "shop";
  const asked = Number(url.searchParams.get("w") ?? 640);
  const width = WIDTHS.find((w) => w >= asked) ?? 1200;
  const height = url.searchParams.get("og") === "1" ? 630 : null;
  if (!UUID_RE.test(id)) return notFound();

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
    auth: { persistSession: false },
  });
  try {
    const { data, error } = await admin.rpc("shops_public_photo_path", { p_photo_id: id, p_kind: kind });
    if (error) {
      console.error("shop-photo: lookup failed", error.message);
      return new Response("Unavailable", { status: 503 });
    }
    const path = typeof data === "string" ? data : null;
    if (!path) return notFound();
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const size = height ? `width=${width}&height=${height}&resize=cover` : `width=${width}&resize=contain`;
    const upstream = await fetch(`${supabaseUrl}/storage/v1/render/image/public/job-photos/${encoded}?${size}&quality=80`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!upstream.ok || !upstream.body) {
      console.error("shop-photo: storage answered", upstream.status);
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
