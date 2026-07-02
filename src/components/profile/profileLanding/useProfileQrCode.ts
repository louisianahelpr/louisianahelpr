import { useState, useEffect } from "react";
import type { Profile } from "./types";

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
          `https://www.louisianahelpr.com/verify/${profile.user_id}`,
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
