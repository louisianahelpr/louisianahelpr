import { Plus, Camera, Image as ImageIcon, FilePlus2, MapPin, AudioLines } from "lucide-react";
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
  /** Share current location — moved here when the composer collapsed to "+". */
  onShareLocation: () => void;
  /** Start a voice note — likewise moved in from the composer row. */
  onRecordVoiceNote: () => void;
  voiceNoteDisabled?: boolean;
  /** Job quick-replies, shown above the send-something actions. */
  quickReplies?: React.ReactNode;
}

/**
 * Quick-attach bottom sheet — three explicit sources (Camera, Library,
 * Files). The user picks where the attachment comes from in one tap rather
 * than fighting an OS picker that may default to the wrong tab. iMessage
 * convention: a sheet with named source buttons, not a single "open" intent.
 */
export const AttachSourceSheet = ({
  open, onOpenChange, onPickCamera, onPickLibrary, onPickFiles,
  onShareLocation, onRecordVoiceNote, voiceNoteDisabled = false, quickReplies,
}: AttachSourceSheetProps) => {
  // Wrap each action so picking one closes the sheet — otherwise it stays
  // open behind the OS picker / permission prompt it just triggered.
  const pick = (fn: () => void) => () => { onOpenChange(false); fn(); };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-w-md mx-auto rounded-t-2xl">
        <SheetHero
          eyebrow={<><Plus className="w-3 h-3" /> Add to this message</>}
          eyebrowClassName="inline-flex items-center gap-1.5"
          title="What are you sending?"
        />
        {/* Quick replies first — they are the likeliest reason to open this
            sheet mid-job ("on my way", "running late"), and unlike the
            attachment sources they SEND on tap rather than opening a picker.
            Separated by a rule so the two halves don't read as one menu. */}
        {quickReplies && (
          <div className="mt-4">
            <div onClick={() => onOpenChange(false)}>{quickReplies}</div>
            <div className="mt-4 h-px" style={{ background: "hsl(var(--olivewood) / 0.12)" }} />
          </div>
        )}
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
                background: "hsl(var(--burnt-sienna) / 0.18)",
                border: "1px solid hsl(var(--burnt-sienna) / 0.32)",
              }}
            >
              <ImageIcon className="w-4 h-4" style={{ color: "hsl(var(--burnt-sienna))" }} />
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
        {/* Location and voice note — the two controls that used to have their
            own buttons in the composer row. Second row rather than squeezed
            into the three-up grid above, because those three answer "where
            does the FILE come from?" and these two are not files at all. */}
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={pick(onShareLocation)}
            className="flex items-center gap-2.5 px-3 py-3 rounded-ds-md transition-colors hover:bg-secondary/40"
            style={{ background: "var(--surface-premium)", border: "0.5px solid hsl(var(--olivewood) / 0.14)" }}
          >
            <MapPin className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--bark))" }} />
            <span className="text-ds-12 font-sans font-medium" style={{ color: "hsl(var(--ink-deep))" }}>
              Location
            </span>
          </button>
          <button
            type="button"
            onClick={pick(onRecordVoiceNote)}
            disabled={voiceNoteDisabled}
            className="flex items-center gap-2.5 px-3 py-3 rounded-ds-md transition-colors hover:bg-secondary/40 disabled:opacity-40 disabled:pointer-events-none"
            style={{ background: "var(--surface-premium)", border: "0.5px solid hsl(var(--olivewood) / 0.14)" }}
          >
            <AudioLines className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--bark))" }} />
            <span className="text-ds-12 font-sans font-medium" style={{ color: "hsl(var(--ink-deep))" }}>
              Voice note
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
