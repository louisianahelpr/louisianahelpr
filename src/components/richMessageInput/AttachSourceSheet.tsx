import { Paperclip, Camera, Image as ImageIcon, FilePlus2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHero,
} from "@/components/ui/sheet";
import { MESSAGE_ATTACHMENT_MAX_BYTES } from "@/lib/messageAttachments";

interface AttachSourceSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPickCamera: () => void;
  onPickLibrary: () => void;
  onPickFiles: () => void;
}

/**
 * Quick-attach bottom sheet — three explicit sources (Camera, Library,
 * Files). The user picks where the attachment comes from in one tap rather
 * than fighting an OS picker that may default to the wrong tab. iMessage
 * convention: a sheet with named source buttons, not a single "open" intent.
 */
export const AttachSourceSheet = ({
  open, onOpenChange, onPickCamera, onPickLibrary, onPickFiles,
}: AttachSourceSheetProps) => {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-w-md mx-auto rounded-t-2xl">
        <SheetHero
          eyebrow={<><Paperclip className="w-3 h-3" /> Send an attachment</>}
          eyebrowClassName="inline-flex items-center gap-1.5"
          title="Where from?"
        />
        <div className="mt-4 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={onPickCamera}
            className="flex flex-col items-center justify-center gap-1.5 px-3 py-4 rounded-ds-md min-h-[88px] transition-colors hover:bg-secondary/40"
            style={{
              background: "var(--surface-premium)",
              border: "0.5px solid hsl(var(--olivewood) / 0.14)",
            }}
          >
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center"
              style={{
                background: "hsl(var(--bark) / 0.10)",
                border: "1px solid hsl(var(--bark) / 0.22)",
              }}
            >
              <Camera className="w-4 h-4" style={{ color: "hsl(var(--bark))" }} />
            </div>
            <span className="font-sans text-ds-13 font-medium" style={{ color: "hsl(var(--ink-deep))" }}>
              Camera
            </span>
          </button>
          <button
            type="button"
            onClick={onPickLibrary}
            className="flex flex-col items-center justify-center gap-1.5 px-3 py-4 rounded-ds-md min-h-[88px] transition-colors hover:bg-secondary/40"
            style={{
              background: "var(--surface-premium)",
              border: "0.5px solid hsl(var(--olivewood) / 0.14)",
            }}
          >
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center"
              style={{
                background: "hsl(var(--gold-warm) / 0.18)",
                border: "1px solid hsl(var(--gold-warm) / 0.32)",
              }}
            >
              <ImageIcon className="w-4 h-4" style={{ color: "hsl(var(--gold-warm))" }} />
            </div>
            <span className="font-sans text-ds-13 font-medium" style={{ color: "hsl(var(--ink-deep))" }}>
              Library
            </span>
          </button>
          <button
            type="button"
            onClick={onPickFiles}
            className="flex flex-col items-center justify-center gap-1.5 px-3 py-4 rounded-ds-md min-h-[88px] transition-colors hover:bg-secondary/40"
            style={{
              background: "var(--surface-premium)",
              border: "0.5px solid hsl(var(--olivewood) / 0.14)",
            }}
          >
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center"
              style={{
                background: "hsl(var(--burnt-sienna) / 0.12)",
                border: "1px solid hsl(var(--burnt-sienna) / 0.28)",
              }}
            >
              <FilePlus2 className="w-4 h-4" style={{ color: "hsl(var(--burnt-sienna))" }} />
            </div>
            <span className="font-sans text-ds-13 font-medium" style={{ color: "hsl(var(--ink-deep))" }}>
              Files
            </span>
          </button>
        </div>
        <p
          className="mt-3 font-serif italic text-ds-12 leading-relaxed text-center"
          style={{ color: "hsl(var(--olivewood) / 0.8)" }}
        >
          Up to {Math.round(MESSAGE_ATTACHMENT_MAX_BYTES / 1024 / 1024)}MB ·
          photos and PDFs only.
        </p>
      </SheetContent>
    </Sheet>
  );
};
