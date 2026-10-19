/**
 * SH2b(d): a printable sign for a shop (owner: NO QR codes anywhere, ~01:30Z
 * 2026-10-18). A letter-size portrait PNG (8.5 x 11 in at 150 dpi): the logo
 * when there is one, the shop's name, what it is and where, and the link in
 * big text so it can be read out loud or typed. Drawn on a canvas in the
 * browser; saved or shared with shareFileNative (Files / Print on iOS, a
 * download on the web).
 */
import { shareFileNative, type ShareFileOutcome } from "@/lib/nativeShare";
import { shopLink } from "./publicShop";

const W = 1275;
const H = 1650;

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    // A logo that will not load (offline, CORS) only leaves the sign without it.
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Break `text` into lines no wider than `max` at the canvas's current font. */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= max || !line) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** The link split where it reads best on paper: the site, then the shop's path. */
function flyerLinkLines(shopId: string): [string, string] {
  const url = shopLink(shopId).replace(/^https:\/\/www\./, "");
  const cut = url.indexOf("/shops/");
  return [url.slice(0, cut) + "/shops/", url.slice(cut + "/shops/".length)];
}

async function drawShopFlyer(shop: { id: string; name: string; category_label?: string | null; area_label?: string | null; logoUrl?: string | null }): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");
  const sans = `Montserrat, "Montserrat Fallback", system-ui, sans-serif`;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#14532d";
  ctx.fillRect(0, 0, W, 36);
  ctx.fillRect(0, H - 36, W, 36);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  let y = 170;
  const logo = shop.logoUrl ? await loadImage(shop.logoUrl) : null;
  if (logo) {
    const size = 360;
    const s = Math.min(logo.width, logo.height);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect((W - size) / 2, y, size, size, 48);
    ctx.clip();
    ctx.drawImage(logo, (logo.width - s) / 2, (logo.height - s) / 2, s, s, (W - size) / 2, y, size, size);
    ctx.restore();
    y += size + 120;
  } else {
    y += 120;
  }

  ctx.fillStyle = "#111827";
  ctx.font = `800 110px ${sans}`;
  for (const line of wrap(ctx, shop.name, W - 160).slice(0, 3)) {
    ctx.fillText(line, W / 2, y);
    y += 124;
  }
  const what = [shop.category_label, shop.area_label].filter(Boolean).join(" · ");
  if (what) {
    ctx.fillStyle = "#374151";
    ctx.font = `600 52px ${sans}`;
    for (const line of wrap(ctx, what, W - 200).slice(0, 2)) {
      ctx.fillText(line, W / 2, y);
      y += 66;
    }
  }

  y = Math.max(y + 80, H - 560);
  ctx.fillStyle = "#14532d";
  ctx.font = `700 56px ${sans}`;
  ctx.fillText("Order and message us on Louisiana Helpr", W / 2, y);
  const [site, path] = flyerLinkLines(shop.id);
  ctx.fillStyle = "#111827";
  ctx.font = `800 72px ${sans}`;
  ctx.fillText(site, W / 2, y + 130);
  ctx.font = `700 40px ${sans}`;
  ctx.fillText(path, W / 2, y + 200);
  ctx.fillStyle = "#6b7280";
  ctx.font = `500 40px ${sans}`;
  ctx.fillText(`Or search "${shop.name}" in the app`, W / 2, y + 300);

  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("flyer_not_drawn"))), "image/png"),
  );
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error ?? new Error("read_failed"));
    r.readAsDataURL(blob);
  });
}

export async function saveShopFlyer(shop: Parameters<typeof drawShopFlyer>[0]): Promise<ShareFileOutcome> {
  const blob = await drawShopFlyer(shop);
  const slug = shop.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "shop";
  return shareFileNative({
    fileName: `${slug}-sign.png`,
    base64: await blobToBase64(blob),
    blob,
    title: `${shop.name} sign`,
    dialogTitle: "Save or print your shop sign",
    source: "shopFlyer",
  });
}
