import { QrCode, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHero,
} from "@/components/ui/dialog";
import { shareNative } from "@/lib/nativeShare";
import type { Profile } from "./types";

interface QrCodeModalProps {
  profile: Profile | null;
  qrOpen: boolean;
  setQrOpen: (open: boolean) => void;
  qrDataUrl: string | null;
}

export function QrCodeModal({ profile, qrOpen, setQrOpen, qrDataUrl }: QrCodeModalProps) {
  return (
    <Dialog open={qrOpen} onOpenChange={setQrOpen}>
      <DialogContent className="max-w-xs mx-auto text-center">
        <DialogHero
          eyebrowClassName="inline-flex items-center gap-1.5"
          eyebrow={<><QrCode className="w-3 h-3" /> Verify at the door</>}
          title="My QR Code"
        />
        <div className="flex flex-col items-center gap-4 py-2">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt="Verification QR code"
              className="w-60 h-60 rounded-ds-md"
              style={{
                boxShadow: "0 2px 12px hsl(var(--olivewood) / 0.12)",
              }}
            />
          ) : (
            <div
              className="w-60 h-60 rounded-ds-md flex items-center justify-center motion-safe:animate-pulse"
              style={{ background: "hsl(var(--bark) / 0.06)" }}
            >
              <QrCode className="w-12 h-12" style={{ color: "hsl(var(--bark) / 0.3)" }} />
            </div>
          )}
          <p className="text-ds-12 leading-relaxed" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            Share with your poster so they can verify you at the door.
          </p>
          <Button
            type="button"
            variant="primary"
            onClick={async () => {
              if (!profile?.user_id) return;
              await shareNative({
                title: "Verify me on Helpr",
                text: `Scan or open this link to verify my identity on Helpr`,
                // `/user/:id`, NOT `/verify/:id`. No `/verify` route exists —
                // App.tsx falls through to `path="*"` → NotFound, and it is
                // absent from apple-app-site-association, so the link neither
                // rendered a page nor opened the app. Matches the QR image
                // itself (see useProfileQrCode).
                url: `https://www.louisianahelpr.com/user/${profile.user_id}`,
                dialogTitle: "Share QR Link",
              });
            }}
            className="w-full"
          >
            <Share2 className="w-4 h-4" />
            Share QR Link
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
