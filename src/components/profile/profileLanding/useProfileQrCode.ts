import { useState, useEffect } from "react";
import type { Profile } from "./types";

// The QR used to encode `/verify/:user_id`. No such route exists — App.tsx has
// no `/verify` entry, `vercel.json` rewrites every path to index.html, and the
// SPA falls through to the `path="*"` NotFound page, so every scan of the
// "Verify at the door" code landed the poster on Helpr's 404 (and `/verify/*`
// isn't claimed in the AASA file either, so it never opened the app). `/user/:id`
// is the profile route that actually exists AND is claimed for Universal Links,
// so a scan opens the helper's profile — which is the thing being verified.
//
// NOTE: `QrCodeModal`'s "Share QR Link" button still sends the dead
// `/verify/:id` URL; it was corrected alongside this.
const verifyUrlFor = (userId: string) =>
  `https://www.louisianahelpr.com/user/${userId}`;

export function useProfileQrCode(profile: Profile | null) {
  const [qrOpen, setQrOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!qrOpen || !profile?.user_id) return;
    if (qrDataUrl) return; // already generated
    let cancelled = false;
    (async () => {
      try {
        const QRCode = (await import("qrcode")).default;
        const url = await QRCode.toDataURL(
          verifyUrlFor(profile.user_id),
          { width: 240, margin: 2, color: { dark: "#1a1208", light: "#faf7f2" } },
        );
        if (!cancelled) setQrDataUrl(url);
      } catch {
        /* QR generation failure is non-fatal — modal still opens */
      }
    })();
    return () => { cancelled = true; };
  }, [qrOpen, profile?.user_id, qrDataUrl]);

  return { qrOpen, setQrOpen, qrDataUrl };
}
